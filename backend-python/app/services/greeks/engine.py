import math
from typing import Dict, Any, List
from datetime import datetime, date

# Standard normal PDF: n(x)
def std_normal_pdf(x: float) -> float:
    return math.exp(-x * x / 2.0) / math.sqrt(2.0 * math.pi)

# Standard normal CDF: N(x) using math.erf
def std_normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

class GreeksEngine:
    """
    Analytical Black-Scholes Greeks and Volatility/Gamma Exposure calculation engine.
    """
    
    @staticmethod
    def calculate_bs_greeks(
        S: float,          # Spot price
        K: float,          # Strike price
        T: float,          # Time to expiration (years)
        r: float,          # Risk-free rate (decimal, e.g. 0.05)
        sigma: float,      # Implied volatility (decimal, e.g. 0.20)
        option_type: str,  # 'C' or 'P'
        q: float = 0.0     # Dividend yield (decimal)
    ) -> Dict[str, float]:
        """
        Computes analytical Black-Scholes price and standard option Greeks:
        Delta, Gamma, Theta, Vega, Rho, Vanna, and Charm.
        """
        # Edge cases
        if T <= 1e-6 or sigma <= 1e-4:
            # Expired or zero volatility
            price = max(0.0, S - K) if option_type == 'C' else max(0.0, K - S)
            delta = 1.0 if (option_type == 'C' and S >= K) else (-1.0 if (option_type == 'P' and S < K) else 0.0)
            return {
                "price": price, "delta": delta, "gamma": 0.0, "theta": 0.0,
                "vega": 0.0, "rho": 0.0, "vanna": 0.0, "charm": 0.0
            }

        # Calculate d1 and d2
        d1 = (math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
        d2 = d1 - sigma * math.sqrt(T)

        # Standard normal distributions
        N_d1 = std_normal_cdf(d1)
        N_d2 = std_normal_cdf(d2)
        n_d1 = std_normal_pdf(d1)
        
        N_minus_d1 = std_normal_cdf(-d1)
        N_minus_d2 = std_normal_cdf(-d2)

        # ── Price ──
        if option_type == 'C':
            price = S * math.exp(-q * T) * N_d1 - K * math.exp(-r * T) * N_d2
        else:
            price = K * math.exp(-r * T) * N_minus_d2 - S * math.exp(-q * T) * N_minus_d1

        # ── Delta ──
        if option_type == 'C':
            delta = math.exp(-q * T) * N_d1
        else:
            delta = -math.exp(-q * T) * N_minus_d1

        # ── Gamma (same for Call and Put) ──
        gamma = math.exp(-q * T) * n_d1 / (S * sigma * math.sqrt(T))

        # ── Vega (same for Call and Put) ──
        vega = S * math.exp(-q * T) * n_d1 * math.sqrt(T)

        # ── Theta ──
        # Daily Theta (divided by 365)
        term1 = -(S * sigma * math.exp(-q * T) * n_d1) / (2.0 * math.sqrt(T))
        if option_type == 'C':
            theta = (term1 + q * S * math.exp(-q * T) * N_d1 - r * K * math.exp(-r * T) * N_d2) / 365.0
        else:
            theta = (term1 - q * S * math.exp(-q * T) * N_minus_d1 + r * K * math.exp(-r * T) * N_minus_d2) / 365.0

        # ── Rho ──
        if option_type == 'C':
            rho = K * T * math.exp(-r * T) * N_d2 / 100.0
        else:
            rho = -K * T * math.exp(-r * T) * N_minus_d2 / 100.0

        # ── Vanna ──
        # dDelta / dSigma (vol sensitivity of delta)
        vanna = -math.exp(-q * T) * n_d1 * d2 / sigma

        # ── Charm ──
        # dDelta / dT (time decay of delta)
        charm_factor = (2.0 * (r - q) * T - d2 * sigma * math.sqrt(T)) / (2.0 * T * sigma * math.sqrt(T))
        if option_type == 'C':
            charm = (q * math.exp(-q * T) * N_d1 - math.exp(-q * T) * n_d1 * charm_factor) / 365.0
        else:
            charm = (-q * math.exp(-q * T) * N_minus_d1 - math.exp(-q * T) * n_d1 * charm_factor) / 365.0

        return {
            "price": price,
            "delta": delta,
            "gamma": gamma,
            "theta": theta,
            "vega": vega / 100.0,  # 1% vol change standard
            "rho": rho,
            "vanna": vanna / 100.0, # 1% vol change standard
            "charm": charm
        }

    @classmethod
    def calculate_exposures(
        cls,
        spot: float,
        strike: float,
        dte: int,
        option_type: str,
        open_interest: int,
        implied_volatility: float,
        risk_free_rate: float,
        contract_size: int = 100
    ) -> Dict[str, float]:
        """
        Computes standard exposures: GEX (Gamma Exposure) and VEX (Vega Exposure).
        Returns both exact BS values and TS proxy values.
        """
        T = max(1e-5, dte / 365.0)
        greeks = cls.calculate_bs_greeks(
            S=spot,
            K=strike,
            T=T,
            r=risk_free_rate,
            sigma=implied_volatility,
            option_type=option_type
        )
        
        sign = 1.0 if option_type == 'C' else -1.0
        
        # ── Gamma Exposure (GEX) ──
        # Exact GEX: sign * spot^2 * gamma * open_interest * contract_size
        # Scaled in Billions for SPX/Index or absolute value
        gex_exact = sign * spot * spot * greeks["gamma"] * open_interest * contract_size / 1e9
        
        # ── Volatility/Vega Exposure (VEX) ──
        # VEX: vega * open_interest * contract_size / 1e9 (in Billions)
        vex_exact = greeks["vega"] * open_interest * contract_size / 1e9

        # Proxies (compatible with existing TS backend formulas)
        gex_proxy = sign * spot * spot * greeks["gamma"] * open_interest / 1e9
        vanna_proxy = greeks["vega"] * greeks["delta"]
        charm_proxy = greeks["delta"] * greeks["theta"]

        return {
            "gex": gex_exact,
            "vex": vex_exact,
            "gex_proxy": gex_proxy,
            "vanna_proxy": vanna_proxy,
            "charm_proxy": charm_proxy,
            "delta": greeks["delta"],
            "gamma": greeks["gamma"],
            "theta": greeks["theta"],
            "vega": greeks["vega"],
            "vanna": greeks["vanna"],
            "charm": greeks["charm"]
        }
