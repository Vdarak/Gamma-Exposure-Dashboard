"""
NSE Participant-Wise Open Interest (EOD) Parser.

Fetches the daily fao_participant_oi_DDMMYYYY.csv from NSE Archives,
parses the four participant categories (Client, DII, FII, Pro), 
and computes dealer positioning weights (ω_CE, ω_PE).

These weights are critical for correctly signing the India GEX calculation.
In India, retail (Client) is heavily net-short options (theta harvesting),
so we cannot use the naive US assumption of dealers being short calls/puts.

Schedule: Mon-Fri at ~8:15 PM IST (14:45 UTC), after NSE clears and publishes.
"""
import httpx
import asyncio
import logging
from datetime import datetime, date, timedelta
from io import StringIO
from typing import Dict, Optional, Any, Tuple

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from sqlalchemy.dialects.postgresql import insert

from app.models.quant import DealerWeight
from app.config import settings

logger = logging.getLogger("gamma-exposure-backend.nse-participant")


class NSEParticipantParser:
    """
    Fetches and parses the NSE Participant-Wise Open Interest CSV report.
    Computes dealer positioning weights (omega_ce, omega_pe) and stores them in DB.
    """
    BASE_URL = "https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_{date_str}.csv"

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
    }

    def __init__(self, db_session: AsyncSession):
        self.db = db_session

    async def fetch_and_calculate_weights(
        self,
        target_date: Optional[date] = None,
        alpha: Optional[float] = None,
    ) -> Optional[Dict[str, float]]:
        """
        Fetch NSE participant OI CSV for the given date, compute dealer weights,
        and store in the database.

        Args:
            target_date: Date to fetch data for. Defaults to today.
            alpha: FII blending factor [0.0-1.0]. Defaults to settings.dealer_alpha.

        Returns:
            Dictionary with omega_ce, omega_pe, and raw participant data.
            None if fetch fails (e.g., holiday).
        """
        if target_date is None:
            target_date = date.today()

        response = None
        actual_date = target_date

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                for day_offset in range(6):
                    check_date = target_date - timedelta(days=day_offset)
                    date_str = check_date.strftime("%d%m%Y")
                    url = self.BASE_URL.format(date_str=date_str)
                    logger.info("Attempting participant OI fetch from: %s", url)
                    resp = await client.get(url, headers=self.HEADERS)
                    if resp.status_code == 200:
                        response = resp
                        actual_date = check_date
                        break
                    elif resp.status_code == 404:
                        logger.info("Date %s not yet published or holiday (404), checking previous trading day...", check_date)
                        continue
                    else:
                        logger.error("HTTP error %d for %s", resp.status_code, url)
                        break

            if not response or response.status_code != 200:
                logger.warning(
                    "NSE participant OI not available for %s or previous 5 trading days. "
                    "Keeping latest cached weights.", target_date
                )
                return None

            if response.status_code != 200:
                logger.error(
                    "Failed to fetch NSE participant OI: HTTP %d", response.status_code
                )
                return None

            # Parse CSV — has leading title line, trailing footnotes and whitespace issues
            raw_text = response.text
            lines = [
                line for line in raw_text.split("\n")
                if line.strip() and not line.strip().startswith("*")
            ]
            if lines and "Participant" in lines[0]:
                lines = lines[1:]
            cleaned_csv = "\n".join(lines)

            import pandas as pd
            df = pd.read_csv(StringIO(cleaned_csv))
            df.columns = df.columns.str.strip()

            # The CSV has a "Client Type" column with rows: Client, DII, FII, Pro, TOTAL
            if "Client Type" not in df.columns:
                logger.error("Unexpected CSV format — 'Client Type' column not found. Columns: %s", list(df.columns))
                return None

            df["Client Type"] = df["Client Type"].str.strip()
            df.set_index("Client Type", inplace=True)

            # Required columns for index option OI
            required_cols = [
                "Option Index Call Long", "Option Index Call Short",
                "Option Index Put Long", "Option Index Put Short"
            ]
            for col in required_cols:
                if col not in df.columns:
                    logger.error("Missing column '%s' in participant OI CSV", col)
                    return None
                df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)

            # Optional futures columns for Method 1 dynamic alpha calculation
            fut_cols = ["Future Index Long", "Future Index Short"]
            has_futures = all(col in df.columns for col in fut_cols)
            if has_futures:
                for col in fut_cols:
                    df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)

            # Extract participant data
            try:
                pro_call_long = int(df.loc["Pro", "Option Index Call Long"])
                pro_call_short = int(df.loc["Pro", "Option Index Call Short"])
                fii_call_long = int(df.loc["FII", "Option Index Call Long"])
                fii_call_short = int(df.loc["FII", "Option Index Call Short"])

                pro_put_long = int(df.loc["Pro", "Option Index Put Long"])
                pro_put_short = int(df.loc["Pro", "Option Index Put Short"])
                fii_put_long = int(df.loc["FII", "Option Index Put Long"])
                fii_put_short = int(df.loc["FII", "Option Index Put Short"])

                total_call_oi = int(df.loc["TOTAL", "Option Index Call Long"])
                total_put_oi = int(df.loc["TOTAL", "Option Index Put Long"])

                fii_fut_long = int(df.loc["FII", "Future Index Long"]) if has_futures else 0
                fii_fut_short = int(df.loc["FII", "Future Index Short"]) if has_futures else 0
            except KeyError as e:
                logger.error("Missing participant row in CSV: %s", e)
                return None

            pro_call_net = pro_call_long - pro_call_short
            fii_call_net = fii_call_long - fii_call_short
            pro_put_net = pro_put_long - pro_put_short
            fii_put_net = fii_put_long - fii_put_short

            # If alpha is not explicitly passed, compute dynamic alpha via Hybrid Model
            alpha_metrics = None
            if alpha is None:
                if has_futures:
                    alpha_metrics = self.calculate_dynamic_alpha(
                        fii_fut_long=fii_fut_long,
                        fii_fut_short=fii_fut_short,
                        fii_call_long=fii_call_long,
                        fii_call_short=fii_call_short,
                        fii_put_long=fii_put_long,
                        fii_put_short=fii_put_short,
                        dte=3,
                        fallback_alpha=settings.dealer_alpha,
                    )
                    alpha = alpha_metrics["alpha_t"]
                else:
                    alpha = settings.dealer_alpha

            # Compute dealer net positioning ratio (ω)
            # ω_CE = (Pro_Call_Net + α * FII_Call_Net) / Total_Call_OI
            omega_ce = float(
                (pro_call_net + alpha * fii_call_net) / total_call_oi
            ) if total_call_oi > 0 else 0.0

            omega_pe = float(
                (pro_put_net + alpha * fii_put_net) / total_put_oi
            ) if total_put_oi > 0 else 0.0

            # Upsert into database
            stmt = insert(DealerWeight).values(
                date=actual_date,
                omega_ce=omega_ce,
                omega_pe=omega_pe,
                alpha=alpha,
                pro_call_long=pro_call_long,
                pro_call_short=pro_call_short,
                fii_call_long=fii_call_long,
                fii_call_short=fii_call_short,
                pro_put_long=pro_put_long,
                pro_put_short=pro_put_short,
                fii_put_long=fii_put_long,
                fii_put_short=fii_put_short,
                total_call_oi=total_call_oi,
                total_put_oi=total_put_oi,
            )
            stmt = stmt.on_conflict_do_update(
                constraint="uq_dealer_weights_date",
                set_={
                    "omega_ce": stmt.excluded.omega_ce,
                    "omega_pe": stmt.excluded.omega_pe,
                    "alpha": stmt.excluded.alpha,
                    "pro_call_long": stmt.excluded.pro_call_long,
                    "pro_call_short": stmt.excluded.pro_call_short,
                    "fii_call_long": stmt.excluded.fii_call_long,
                    "fii_call_short": stmt.excluded.fii_call_short,
                    "pro_put_long": stmt.excluded.pro_put_long,
                    "pro_put_short": stmt.excluded.pro_put_short,
                    "fii_put_long": stmt.excluded.fii_put_long,
                    "fii_put_short": stmt.excluded.fii_put_short,
                    "total_call_oi": stmt.excluded.total_call_oi,
                    "total_put_oi": stmt.excluded.total_put_oi,
                },
            )
            await self.db.execute(stmt)
            await self.db.commit()

            result = {
                "date": actual_date.isoformat(),
                "omega_ce": round(omega_ce, 6),
                "omega_pe": round(omega_pe, 6),
                "alpha": alpha,
                "pro_call_net": pro_call_net,
                "fii_call_net": fii_call_net,
                "pro_put_net": pro_put_net,
                "fii_put_net": fii_put_net,
                "total_call_oi": total_call_oi,
                "total_put_oi": total_put_oi,
                "fii_regime": alpha_metrics.get("fii_regime", "MARKET_MAKER") if alpha_metrics else "MARKET_MAKER",
                "hedging_ratio_ht": alpha_metrics.get("hedging_ratio_ht", 0.50) if alpha_metrics else 0.50,
            }

            logger.info("✅ Dealer weights updated: ω_CE=%.4f, ω_PE=%.4f (date=%s, α=%.4f, regime=%s)",
                         omega_ce, omega_pe, actual_date, alpha, result["fii_regime"])
            return result

        except Exception as e:
            logger.error("Error fetching/parsing NSE participant OI: %s", str(e))
            return None

    @staticmethod
    def calculate_dynamic_alpha(
        fii_fut_long: float,
        fii_fut_short: float,
        fii_call_long: float,
        fii_call_short: float,
        fii_put_long: float,
        fii_put_short: float,
        dte: int = 3,
        alpha_min: float = 0.20,
        alpha_max: float = 0.80,
        fallback_alpha: float = 0.65,
    ) -> Dict[str, Any]:
        """
        Computes dynamic alpha_t using Hybrid Model:
        Futures-Options Delta-Hedging Alignment (Method 1) + DTE Overlay.

        Args:
            fii_fut_long: FII Future Index Long contracts
            fii_fut_short: FII Future Index Short contracts
            fii_call_long: FII Option Index Call Long contracts
            fii_call_short: FII Option Index Call Short contracts
            fii_put_long: FII Option Index Put Long contracts
            fii_put_short: FII Option Index Put Short contracts
            dte: Days to expiration (default 3)
            alpha_min: Minimum base alpha (0.20)
            alpha_max: Maximum base alpha (0.80)
            fallback_alpha: Default fallback alpha (0.65)

        Returns:
            Dict containing alpha_t, hedging_ratio_ht, net_futures, net_option_delta, fii_regime.
        """
        try:
            net_futures = fii_fut_long - fii_fut_short
            net_calls = fii_call_long - fii_call_short
            net_puts = fii_put_long - fii_put_short

            # Aggregate Option Delta Approximation: Delta(Long Call) = +0.5, Delta(Long Put) = -0.5
            net_option_delta = 0.5 * (net_calls - net_puts)

            sum_delta = net_futures + net_option_delta
            abs_sum = abs(sum_delta)
            gross_exposure = abs(net_futures) + abs(net_option_delta)

            if gross_exposure == 0:
                ht = 0.50
            else:
                ht = 1.0 - (abs_sum / gross_exposure)

            # Base alpha from hedging behavior
            base_alpha = alpha_min + (alpha_max - alpha_min) * ht

            # DTE Overlay (0DTE/1DTE has higher HFT MM participation)
            dte_factor = max(0.0, 1.0 - (min(dte, 7) / 7.0))
            dte_boost = 0.10 * dte_factor

            # Final Clamped Alpha [0.15, 0.90]
            unclamped_alpha = base_alpha + dte_boost
            alpha_t = min(max(unclamped_alpha, 0.15), 0.90)

            return {
                "alpha_t": round(float(alpha_t), 4),
                "hedging_ratio_ht": round(float(ht), 4),
                "net_futures": net_futures,
                "net_option_delta": net_option_delta,
                "fii_regime": "MARKET_MAKER" if alpha_t >= 0.55 else "DIRECTIONAL_SPECULATOR",
            }
        except Exception as e:
            logger.warning("Error calculating dynamic alpha, using fallback %.2f: %s", fallback_alpha, e)
            return {
                "alpha_t": fallback_alpha,
                "hedging_ratio_ht": 0.50,
                "net_futures": 0.0,
                "net_option_delta": 0.0,
                "fii_regime": "MARKET_MAKER" if fallback_alpha >= 0.55 else "DIRECTIONAL_SPECULATOR",
            }

    @staticmethod
    async def get_latest_weights(db: AsyncSession) -> Dict[str, float]:
        """
        Retrieve the most recent dealer weights from the database.
        Falls back to conservative neutral assumptions if no data exists.
        """
        stmt = select(DealerWeight).order_by(desc(DealerWeight.date)).limit(1)
        result = await db.execute(stmt)
        row = result.scalar_one_or_none()

        if row is None:
            logger.warning(
                "No dealer weights in DB — using fallback neutral assumptions "
                "(ω_CE=-0.30, ω_PE=-0.30)"
            )
            return {
                "omega_ce": -0.30,
                "omega_pe": -0.30,
                "date": None,
                "alpha": settings.dealer_alpha,
                "is_fallback": True,
            }

        return {
            "omega_ce": float(row.omega_ce),
            "omega_pe": float(row.omega_pe),
            "date": row.date.isoformat(),
            "alpha": float(row.alpha),
            "is_fallback": False,
        }
