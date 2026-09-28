"""
DhanHQ v2 Option Chain Client.

Wraps the dhanhq library to fetch live option chain data for Indian indices
(NIFTY, BANKNIFTY, SENSEX) and normalizes it into the shared NormalizedSnapshot
schema used by the rest of the ingestion pipeline.

Key advantages over NSE direct scraping:
  - Pre-computed Greeks (gamma, delta, IV) from Dhan's server
  - Proper REST API with stable contracts (no cookie dance)
  - No rate limiting issues
"""
import logging
from datetime import datetime, date, timezone, timedelta
from typing import Optional, List

from dhanhq import dhanhq

from app.config import settings, get_lot_size, get_instrument, get_all_india_symbols
from app.services.ingestion.normalizer import NormalizedSnapshot, OptionContract

logger = logging.getLogger("gamma-exposure-backend.dhan-client")


class DhanOptionChainClient:
    """
    Fetches option chain data from DhanHQ v2 API and returns NormalizedSnapshot objects.
    """

    # Dhan security IDs for indices
    INDEX_SCRIP_MAP = {
        "NIFTY": 13,
        "BANKNIFTY": 25,
        "SENSEX": 51,
    }

    def __init__(self):
        self.client_id = settings.dhan_client_id
        self.access_token = settings.dhan_access_token
        self._dhan: Optional[dhanhq] = None

    def _get_dhan(self) -> dhanhq:
        """Lazy-init Dhan client (re-reads token from settings in case it was renewed)."""
        current_token = settings.dhan_access_token
        if self._dhan is None or self.access_token != current_token:
            self.access_token = current_token
            from dhanhq import DhanContext
            ctx = DhanContext(self.client_id, self.access_token)
            self._dhan = dhanhq(ctx)
        return self._dhan

    async def get_normalized_snapshot(self, ticker: str) -> Optional[NormalizedSnapshot]:
        """
        Fetch the full option chain for an Indian index from Dhan v2 API.
        Returns a NormalizedSnapshot compatible with the shared data pipeline.

        Args:
            ticker: Symbol name (NIFTY, BANKNIFTY, SENSEX)

        Returns:
            NormalizedSnapshot with market="IND", or None on failure.
        """
        ticker = ticker.upper()
        instrument = get_instrument(ticker)

        if not instrument:
            logger.error("Unknown India ticker: %s", ticker)
            return None

        if not self.client_id or not settings.dhan_access_token:
            logger.warning("Dhan credentials not configured — skipping %s", ticker)
            return None

        sec_id = self.INDEX_SCRIP_MAP.get(ticker)
        if not sec_id:
            logger.error("No Dhan scrip mapping for ticker: %s", ticker)
            return None

        underlying_seg = instrument.get("underlying_seg", "IDX_I")

        try:
            dhan = self._get_dhan()

            # 1. Fetch available expiries from Dhan
            exp_res = dhan.expiry_list(
                under_security_id=sec_id,
                under_exchange_segment=underlying_seg,
            )
            expiries = []
            if isinstance(exp_res, dict) and exp_res.get("status") == "success":
                expiries = exp_res.get("data", {}).get("data", [])

            if not expiries:
                logger.error("[Dhan %s] Empty expiry list from Dhan API: %s", ticker, exp_res)
                return None

            contracts: List[OptionContract] = []
            spot_price = 0.0

            # Fetch top expiries (near-term weekly/monthly)
            max_exp = 3
            for exp in expiries[:max_exp]:
                chain_response = dhan.option_chain(
                    under_security_id=sec_id,
                    under_exchange_segment=underlying_seg,
                    expiry=exp,
                )

                if not chain_response or not isinstance(chain_response, dict):
                    continue

                if chain_response.get("status") != "success":
                    logger.warning("[Dhan %s] Failed to fetch chain for expiry %s", ticker, exp)
                    continue

                data = chain_response.get("data", {})
                if isinstance(data, dict) and "data" in data:
                    data = data["data"]

                if isinstance(data, dict):
                    if spot_price == 0.0:
                        spot_price = float(data.get("last_price", 0) or 0)
                    oc_data = data.get("oc", {})

                    # Extract real ATM IV from the traded strike closest to spot for this expiry
                    atm_iv = 0.0
                    if spot_price > 0 and oc_data:
                        try:
                            sorted_strikes = sorted(
                                [(float(k), v) for k, v in oc_data.items() if isinstance(v, dict)],
                                key=lambda item: abs(item[0] - spot_price)
                            )
                            for _, strike_details in sorted_strikes[:5]:
                                for lk in ("ce", "pe"):
                                    l = strike_details.get(lk, {})
                                    if isinstance(l, dict):
                                        liv = float(l.get("greeks", {}).get("iv", 0) or l.get("implied_volatility", 0) or 0)
                                        if liv > 0:
                                            atm_iv = liv / 100.0 if liv > 1.0 else liv
                                            break
                                if atm_iv > 0:
                                    break
                        except Exception as e:
                            logger.debug("[Dhan %s] Error deriving ATM IV: %s", ticker, e)

                    for strike_str, details in oc_data.items():
                        try:
                            strike = float(strike_str)
                        except (ValueError, TypeError):
                            continue

                        for leg_key, opt_type in [("ce", "C"), ("pe", "P")]:
                            leg = details.get(leg_key) if isinstance(details, dict) else None
                            if not leg or not isinstance(leg, dict):
                                continue

                            contract = self._parse_leg(
                                leg,
                                strike,
                                opt_type,
                                ticker,
                                expiry_default=exp,
                                spot_price=spot_price,
                                atm_iv=atm_iv,
                            )
                            if contract:
                                contracts.append(contract)

            if not contracts:
                logger.warning("[Dhan %s] No option contracts parsed from response", ticker)
                return None

            if spot_price == 0.0:
                logger.warning("[Dhan %s] Could not determine spot price from option chain", ticker)
                return None

            # Deduplicate
            unique_map = {}
            for c in contracts:
                key = f"{c.strike}_{c.option_type}_{c.expiration}"
                unique_map[key] = c

            logger.info(
                "[Dhan %s] ✅ Fetched %d unique contracts. Spot: %.2f",
                ticker, len(unique_map), spot_price
            )

            return NormalizedSnapshot(
                ticker=ticker,
                timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
                spot_price=spot_price,
                market="IND",
                options=list(unique_map.values()),
            )

        except Exception as e:
            logger.error("[Dhan %s] ❌ Error fetching option chain: %s", ticker, str(e))
            return None

    def _parse_leg(
        self,
        leg: dict,
        strike: float,
        opt_type: str,
        ticker: str,
        expiry_default: Optional[str] = None,
        spot_price: float = 0.0,
        atm_iv: float = 0.0,
    ) -> Optional[OptionContract]:
        """Parse a single option leg dict into an OptionContract, computing BS Greeks if Dhan returned zeroes."""
        try:
            # Parse expiry date — Dhan may return various formats or use the parent expiry
            exp_raw = leg.get("expiry_date") or leg.get("expiryDate") or leg.get("expiry") or expiry_default
            if not exp_raw:
                return None

            if isinstance(exp_raw, str):
                # Try common formats
                for fmt in ("%Y-%m-%d", "%d-%b-%Y", "%d-%m-%Y", "%d/%m/%Y"):
                    try:
                        exp_date = datetime.strptime(exp_raw, fmt).date()
                        break
                    except ValueError:
                        continue
                else:
                    return None
            elif isinstance(exp_raw, date):
                exp_date = exp_raw
            else:
                return None

            # Extract Greeks (pre-computed by Dhan)
            greeks = leg.get("greeks", {}) if isinstance(leg.get("greeks"), dict) else {}
            gamma = float(greeks.get("gamma", 0) or leg.get("gamma", 0) or 0)
            delta = float(greeks.get("delta", 0) or leg.get("delta", 0) or 0)
            theta = float(greeks.get("theta", 0) or leg.get("theta", 0) or 0)
            vega = float(greeks.get("vega", 0) or leg.get("vega", 0) or 0)

            # IV — normalize to decimal (0.25 for 25%)
            raw_iv = float(greeks.get("iv", 0) or leg.get("implied_volatility", 0) or
                          leg.get("impliedVolatility", 0) or leg.get("iv", 0) or 0)
            iv = raw_iv / 100.0 if raw_iv > 1.0 else raw_iv

            oi = int(leg.get("oi", 0) or leg.get("open_interest", 0) or leg.get("openInterest", 0) or 0)
            volume = int(leg.get("volume", 0) or leg.get("totalTradedVolume", 0) or 0)
            ltp = float(leg.get("ltp", 0) or leg.get("last_price", 0) or leg.get("lastPrice", 0) or 0)
            bid = float(leg.get("bid", 0) or leg.get("bid_price", 0) or leg.get("bidprice", 0) or 0)
            ask = float(leg.get("ask", 0) or leg.get("ask_price", 0) or leg.get("askPrice", 0) or 0)

            change_in_oi = int(leg.get("oi_change", 0) or leg.get("changeinOpenInterest", 0) or
                              leg.get("change_in_oi", 0) or 0)

            # Exchange Ghost & Corrupted Strike Filter:
            # 1. Zero volume + Zero previous OI cannot legitimately have positive open interest on an exchange
            prev_oi = int(leg.get("previous_oi", 0) or leg.get("prev_oi", 0) or 0)
            if volume == 0 and prev_oi == 0 and oi > 50000:
                logger.warning(
                    "[Dhan %s] Dropping corrupted ghost strike: strike=%.1f %s OI=%d Vol=%d PrevOI=%d",
                    ticker, strike, opt_type, oi, volume, prev_oi
                )
                return None

            # 2. Deep strikes (>3% away from spot) with 0 volume and abnormally high OI (>500,000)
            if spot_price > 0 and volume == 0 and oi > 500000 and abs(strike - spot_price) / spot_price > 0.03:
                logger.warning(
                    "[Dhan %s] Dropping anomalous deep strike: strike=%.1f %s OI=%d Vol=%d",
                    ticker, strike, opt_type, oi, volume
                )
                return None

            # Mathematical Fallback & Smoothing:
            # If Dhan omitted Greeks (gamma=0/delta=0) OR if the strike is illiquid (vol=0) away from spot (>2%),
            # Dhan's reported IV is often corrupted by stale trades from weeks ago.
            # Calculate exact Black-Scholes Greeks using ATM IV so gamma correctly decays to 0.
            today = date.today()
            dte_days = (exp_date - today).days
            T = max(dte_days, 0.25) / 365.0

            is_illiquid_skew = (spot_price > 0 and volume == 0 and abs(strike - spot_price) / spot_price > 0.02)
            needs_bs_calc = (spot_price > 0 and (gamma == 0.0 or delta == 0.0 or is_illiquid_skew))

            if needs_bs_calc:
                effective_iv = atm_iv if is_illiquid_skew else (iv if iv > 0 else atm_iv)
                if effective_iv > 0:
                    try:
                        from app.services.greeks.engine import GreeksEngine
                        bs = GreeksEngine.calculate_bs_greeks(
                            S=spot_price,
                            K=strike,
                            T=T,
                            r=0.065,  # India 91-day T-Bill risk-free rate ~6.5%
                            sigma=effective_iv,
                            option_type=opt_type,
                        )
                        gamma = bs["gamma"]
                        delta = bs["delta"]
                        theta = bs["theta"]
                        vega = bs["vega"]
                        if iv == 0.0 or is_illiquid_skew:
                            iv = effective_iv
                    except Exception as bs_err:
                        logger.debug("[Dhan %s] BS Greek calc error at strike %.1f: %s", ticker, strike, bs_err)

            return OptionContract(
                strike=strike,
                option_type=opt_type,
                expiration=exp_date,
                last_price=ltp,
                bid=bid,
                ask=ask,
                volume=volume,
                open_interest=oi,
                implied_volatility=iv,
                delta=delta,
                gamma=gamma,
                theta=theta,
                vega=vega,
                rho=0.0,
                change_in_oi=change_in_oi,
            )

        except Exception as e:
            logger.debug("[Dhan %s] Skipping leg at strike %.1f: %s", ticker, strike, e)
            return None
