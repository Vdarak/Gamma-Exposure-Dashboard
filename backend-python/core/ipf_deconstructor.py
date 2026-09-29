"""
Core Strike-Level Position Deconstructor via Iterative Proportional Fitting (IPF).

Recovers the unobservable matrix X_{k, p} representing the distribution of option
contracts across strikes k in {1, ..., K} and participant types p in {Client, DII, FII, Pro}
for both Calls and Puts (Long and Short).

Uses the Sinkhorn-Knopp (biproportional scaling / RAS) algorithm seeded with structural
behavioral priors reflecting real Indian institutional option market mechanics.
"""

import numpy as np
import logging
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger("gamma-exposure-backend.ipf-deconstructor")

PARTICIPANTS = ["Client", "DII", "FII", "Pro"]
PARTICIPANT_INDEX = {p: i for i, p in enumerate(PARTICIPANTS)}


def generate_prior_weights(
    strike: float,
    spot: float,
    iv: float,
    dte: float,
    participant: str,
    option_type: str,
    side: str,
) -> float:
    """
    Computes prior probability P[k, p] based on empirical institutional mechanics.

    - DII: Legally restricted from naked option buying; almost zero in deep OTM (>1.2 std dev).
    - Client (Retail):
        * Short: Heavily writes OTM options for theta decay (1.0 to 2.5 std devs out).
        * Long: Buys cheap lottery wings (deep OTM >2.5 std devs out).
    - Pro: Market-makers/prop desks centering inventory tight around ATM (straddles/strangles <=0.7 std devs).
    - FII: Quant desks trading near-ATM + macro tail-risk hedges in OTM puts (<0.95 moneyness).
    """
    if spot <= 0:
        return 1.0

    moneyness = strike / spot
    # Normalize distance by standard deviation: sigma * sqrt(T)
    T = max(dte / 365.0, 0.0001)
    iv_clean = max(iv, 0.05) if iv > 0 else 0.15
    std_dev = max(iv_clean * (T ** 0.5), 0.005)
    z_score = abs(strike - spot) / (spot * std_dev)

    if participant == "DII":
        # DIIs are legally restricted from naked option buying; almost zero in deep OTM
        return 0.001 if z_score > 1.2 else float(np.exp(-0.5 * (z_score / 0.5) ** 2))

    elif participant == "Client":
        if side == "Short":
            # Retail heavily writes OTM options for theta decay (1.0 to 2.5 std devs out)
            return float(np.exp(-0.5 * ((z_score - 1.5) / 0.6) ** 2))
        else:
            # Retail buys cheap lottery wings (deep OTM)
            return float(np.exp(-0.5 * ((z_score - 2.5) / 0.8) ** 2))

    elif participant == "Pro":
        # Market-makers/prop desks center inventory tight around ATM (straddles/strangles)
        return float(np.exp(-0.5 * (z_score / 0.7) ** 2))

    elif participant == "FII":
        # Quant desks trade near-ATM; macro tail-risk hedges sit in OTM puts
        if option_type == "PE" and moneyness < 0.95:
            return float(1.8 * np.exp(-0.5 * ((z_score - 1.2) / 0.8) ** 2))
        return float(np.exp(-0.5 * (z_score / 0.9) ** 2))

    return 1.0


def fit_ipf(
    row_targets: np.ndarray,
    col_targets: np.ndarray,
    prior_matrix: np.ndarray,
    max_iter: int = 500,
    tol: float = 1e-5,
) -> np.ndarray:
    """
    Iterative Proportional Fitting (RAS / Sinkhorn-Knopp algorithm).
    row_targets: Shape (K,) - Strike Open Interests
    col_targets: Shape (P,) - Participant Totals
    prior_matrix: Shape (K, P) - Initial behavioral estimates
    """
    row_sum = float(row_targets.sum())
    col_sum = float(col_targets.sum())

    if row_sum <= 0:
        return np.zeros_like(prior_matrix)

    # Normalize col_targets to match row_targets sum to ensure mathematical convergence
    scaled_col_targets = col_targets * (row_sum / col_sum) if col_sum > 0 else np.full_like(col_targets, row_sum / len(col_targets))

    X = np.copy(prior_matrix).astype(float)
    # Ensure no exact zeros in prior to prevent division by zero
    X = np.maximum(X, 1e-8)

    for iteration in range(max_iter):
        # 1. Scale Rows to match strike totals
        row_sums = X.sum(axis=1, keepdims=True)
        row_sums[row_sums == 0] = 1.0
        X = X * (row_targets[:, np.newaxis] / row_sums)

        # 2. Scale Columns to match participant totals
        col_sums = X.sum(axis=0, keepdims=True)
        col_sums[col_sums == 0] = 1.0
        X = X * (scaled_col_targets[np.newaxis, :] / col_sums)

        # Check convergence using L_infinity norm
        row_err = np.max(np.abs(X.sum(axis=1) - row_targets))
        col_err = np.max(np.abs(X.sum(axis=0) - scaled_col_targets))
        if max(row_err, col_err) < tol:
            break

    return X


class IPFDeconstructor:
    """
    Deconstructs strike-level option chain into participant positions
    and computes granular dealer gamma.
    """

    def __init__(self, max_iter: int = 500, tol: float = 1e-5):
        self.max_iter = max_iter
        self.tol = tol

    def build_prior_matrix(
        self,
        strikes: List[float],
        spot: float,
        iv_list: List[float],
        dte: float,
        option_type: str,
        side: str,
    ) -> np.ndarray:
        """
        Builds K x P prior matrix P_{k, p}.
        """
        K = len(strikes)
        P = len(PARTICIPANTS)
        prior = np.zeros((K, P), dtype=float)

        for k_idx, strike in enumerate(strikes):
            iv = iv_list[k_idx] if k_idx < len(iv_list) else 0.15
            for p_idx, participant in enumerate(PARTICIPANTS):
                prior[k_idx, p_idx] = generate_prior_weights(
                    strike=strike,
                    spot=spot,
                    iv=iv,
                    dte=dte,
                    participant=participant,
                    option_type=option_type,
                    side=side,
                )

        return prior

    def deconstruct_single_chain(
        self,
        strikes: List[float],
        strike_oi: np.ndarray,
        participant_totals: np.ndarray,
        spot: float,
        iv_list: List[float],
        dte: float,
        option_type: str,
        side: str,
    ) -> np.ndarray:
        """
        Executes IPF for a single slice (e.g. Call Long or Put Short).
        Returns K x P matrix X_{k, p}.
        """
        prior = self.build_prior_matrix(
            strikes=strikes,
            spot=spot,
            iv_list=iv_list,
            dte=dte,
            option_type=option_type,
            side=side,
        )

        return fit_ipf(
            row_targets=strike_oi,
            col_targets=participant_totals,
            prior_matrix=prior,
            max_iter=self.max_iter,
            tol=self.tol,
        )

    def deconstruct_full_chain(
        self,
        strikes: List[float],
        spot: float,
        dte: float,
        ce_oi: np.ndarray,
        pe_oi: np.ndarray,
        ce_iv: List[float],
        pe_iv: List[float],
        participant_eod: Dict[str, Dict[str, float]],
        gammas: Optional[np.ndarray] = None,
    ) -> Dict[str, Any]:
        """
        Full 4-way deconstruction:
          1. Call Long
          2. Call Short
          3. Put Long
          4. Put Short

        Computes strike-level net positioning and Net Dealer Gamma:
          Net Dealer Gamma_k = sum_{p in {Pro, FII}} (X_{k, p, Long} - X_{k, p, Short}) * Gamma_k
        """
        K = len(strikes)
        if K == 0:
            return {"error": "No strikes provided"}

        # Extract column marginals for all 4 slices
        ce_long_col = np.array([participant_eod[p]["call_long"] for p in PARTICIPANTS], dtype=float)
        ce_short_col = np.array([participant_eod[p]["call_short"] for p in PARTICIPANTS], dtype=float)
        pe_long_col = np.array([participant_eod[p]["put_long"] for p in PARTICIPANTS], dtype=float)
        pe_short_col = np.array([participant_eod[p]["put_short"] for p in PARTICIPANTS], dtype=float)

        # Run 4-way balanced IPF
        X_ce_long = self.deconstruct_single_chain(
            strikes=strikes, strike_oi=ce_oi, participant_totals=ce_long_col,
            spot=spot, iv_list=ce_iv, dte=dte, option_type="CE", side="Long"
        )
        X_ce_short = self.deconstruct_single_chain(
            strikes=strikes, strike_oi=ce_oi, participant_totals=ce_short_col,
            spot=spot, iv_list=ce_iv, dte=dte, option_type="CE", side="Short"
        )
        X_pe_long = self.deconstruct_single_chain(
            strikes=strikes, strike_oi=pe_oi, participant_totals=pe_long_col,
            spot=spot, iv_list=pe_iv, dte=dte, option_type="PE", side="Long"
        )
        X_pe_short = self.deconstruct_single_chain(
            strikes=strikes, strike_oi=pe_oi, participant_totals=pe_short_col,
            spot=spot, iv_list=pe_iv, dte=dte, option_type="PE", side="Short"
        )

        # Net positions across strikes: Shape (K, P)
        # In options, Long Call = +Delta, Short Call = -Delta, Long Put = -Delta, Short Put = +Delta
        net_ce = X_ce_long - X_ce_short
        net_pe = X_pe_long - X_pe_short

        pro_idx = PARTICIPANT_INDEX["Pro"]
        fii_idx = PARTICIPANT_INDEX["FII"]
        client_idx = PARTICIPANT_INDEX["Client"]
        dii_idx = PARTICIPANT_INDEX["DII"]

        # Net Dealer contracts at strike k:
        # For Calls: Dealers long calls = +Gamma, dealers short calls = -Gamma
        # For Puts: Dealers long puts = +Gamma, dealers short puts = -Gamma
        dealer_call_net = (net_ce[:, pro_idx] + net_ce[:, fii_idx])
        dealer_put_net = (net_pe[:, pro_idx] + net_pe[:, fii_idx])

        # If gammas are provided, calculate Net Dealer Gamma per strike
        dealer_gamma_k = np.zeros(K, dtype=float)
        if gammas is not None and len(gammas) == K:
            # Dealer net position in calls and puts weighted by strike gamma
            dealer_gamma_k = (dealer_call_net + dealer_put_net) * gammas

        # Build clean structured output
        strike_breakdown = []
        for i, s in enumerate(strikes):
            strike_breakdown.append({
                "strike": float(s),
                "ce_oi": int(round(ce_oi[i])),
                "pe_oi": int(round(pe_oi[i])),
                "client": {
                    "ce_long": int(round(X_ce_long[i, client_idx])),
                    "ce_short": int(round(X_ce_short[i, client_idx])),
                    "ce_net": int(round(net_ce[i, client_idx])),
                    "pe_long": int(round(X_pe_long[i, client_idx])),
                    "pe_short": int(round(X_pe_short[i, client_idx])),
                    "pe_net": int(round(net_pe[i, client_idx])),
                },
                "pro": {
                    "ce_long": int(round(X_ce_long[i, pro_idx])),
                    "ce_short": int(round(X_ce_short[i, pro_idx])),
                    "ce_net": int(round(net_ce[i, pro_idx])),
                    "pe_long": int(round(X_pe_long[i, pro_idx])),
                    "pe_short": int(round(X_pe_short[i, pro_idx])),
                    "pe_net": int(round(net_pe[i, pro_idx])),
                },
                "fii": {
                    "ce_long": int(round(X_ce_long[i, fii_idx])),
                    "ce_short": int(round(X_ce_short[i, fii_idx])),
                    "ce_net": int(round(net_ce[i, fii_idx])),
                    "pe_long": int(round(X_pe_long[i, fii_idx])),
                    "pe_short": int(round(X_pe_short[i, fii_idx])),
                    "pe_net": int(round(net_pe[i, fii_idx])),
                },
                "dii": {
                    "ce_long": int(round(X_ce_long[i, dii_idx])),
                    "ce_short": int(round(X_ce_short[i, dii_idx])),
                    "ce_net": int(round(net_ce[i, dii_idx])),
                    "pe_long": int(round(X_pe_long[i, dii_idx])),
                    "pe_short": int(round(X_pe_short[i, dii_idx])),
                    "pe_net": int(round(net_pe[i, dii_idx])),
                },
                "dealer_net_ce": int(round(dealer_call_net[i])),
                "dealer_net_pe": int(round(dealer_put_net[i])),
                "dealer_gamma": float(dealer_gamma_k[i]),
            })

        return {
            "spot": spot,
            "dte": dte,
            "total_strikes": K,
            "net_dealer_gamma_total": float(dealer_gamma_k.sum()),
            "strikes": strike_breakdown,
        }
