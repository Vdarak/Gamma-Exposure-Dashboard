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
from typing import Dict, Optional, Any, Tuple, List

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from sqlalchemy.dialects.postgresql import insert

from app.models.quant import DealerWeight, ParticipantOIDaily
from app.config import settings

logger = logging.getLogger("gamma-exposure-backend.nse-participant")


class NSEParticipantParser:
    """
    Fetches and parses the NSE Participant-Wise Open Interest CSV report.
    Computes dealer positioning weights (omega_ce, omega_pe), stores complete
    participant breakdown (Client, DII, FII, Pro), and provides historical backfills.
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

    @staticmethod
    def parse_participant_csv(raw_text: str, report_date: date) -> Optional[Dict[str, Any]]:
        """
        Parses raw NSE participant CSV text into a structured dictionary.
        Extracts all 4 participant segments (Client, DII, FII, Pro, TOTAL)
        and computes derived net metrics.
        """
        import pandas as pd
        lines = [
            line for line in raw_text.split("\n")
            if line.strip() and not line.strip().startswith("*")
        ]
        if lines and "Participant" in lines[0]:
            lines = lines[1:]
        cleaned_csv = "\n".join(lines)

        try:
            df = pd.read_csv(StringIO(cleaned_csv))
            df.columns = df.columns.str.strip()

            if "Client Type" not in df.columns:
                logger.error("Unexpected CSV format — 'Client Type' column not found: %s", list(df.columns))
                return None

            df["Client Type"] = df["Client Type"].str.strip()
            df.set_index("Client Type", inplace=True)

            required_cols = [
                "Option Index Call Long", "Option Index Call Short",
                "Option Index Put Long", "Option Index Put Short"
            ]
            for col in required_cols:
                if col not in df.columns:
                    logger.error("Missing column '%s' in participant OI CSV", col)
                    return None
                df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)

            fut_cols = ["Future Index Long", "Future Index Short"]
            for col in fut_cols:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)
                else:
                    df[col] = 0

            # 1. Client
            client_fut_long = int(df.loc["Client", "Future Index Long"])
            client_fut_short = int(df.loc["Client", "Future Index Short"])
            client_call_long = int(df.loc["Client", "Option Index Call Long"])
            client_call_short = int(df.loc["Client", "Option Index Call Short"])
            client_put_long = int(df.loc["Client", "Option Index Put Long"])
            client_put_short = int(df.loc["Client", "Option Index Put Short"])

            # 2. DII
            dii_fut_long = int(df.loc["DII", "Future Index Long"])
            dii_fut_short = int(df.loc["DII", "Future Index Short"])
            dii_call_long = int(df.loc["DII", "Option Index Call Long"])
            dii_call_short = int(df.loc["DII", "Option Index Call Short"])
            dii_put_long = int(df.loc["DII", "Option Index Put Long"])
            dii_put_short = int(df.loc["DII", "Option Index Put Short"])

            # 3. FII
            fii_fut_long = int(df.loc["FII", "Future Index Long"])
            fii_fut_short = int(df.loc["FII", "Future Index Short"])
            fii_call_long = int(df.loc["FII", "Option Index Call Long"])
            fii_call_short = int(df.loc["FII", "Option Index Call Short"])
            fii_put_long = int(df.loc["FII", "Option Index Put Long"])
            fii_put_short = int(df.loc["FII", "Option Index Put Short"])

            # 4. Pro
            pro_fut_long = int(df.loc["Pro", "Future Index Long"])
            pro_fut_short = int(df.loc["Pro", "Future Index Short"])
            pro_call_long = int(df.loc["Pro", "Option Index Call Long"])
            pro_call_short = int(df.loc["Pro", "Option Index Call Short"])
            pro_put_long = int(df.loc["Pro", "Option Index Put Long"])
            pro_put_short = int(df.loc["Pro", "Option Index Put Short"])

            # TOTAL
            if "TOTAL" in df.index:
                total_fut_oi = int(df.loc["TOTAL", "Future Index Long"])
                total_call_oi = int(df.loc["TOTAL", "Option Index Call Long"])
                total_put_oi = int(df.loc["TOTAL", "Option Index Put Long"])
            else:
                total_fut_oi = client_fut_long + dii_fut_long + fii_fut_long + pro_fut_long
                total_call_oi = client_call_long + dii_call_long + fii_call_long + pro_call_long
                total_put_oi = client_put_long + dii_put_long + fii_put_long + pro_put_long

            # Derived Net positions
            fii_net_fut = fii_fut_long - fii_fut_short
            fii_net_ce = fii_call_long - fii_call_short
            fii_net_pe = fii_put_long - fii_put_short
            fii_tot_fut = fii_fut_long + fii_fut_short
            fii_ratio = round(fii_fut_long / fii_tot_fut, 4) if fii_tot_fut > 0 else 0.5000

            pro_net_fut = pro_fut_long - pro_fut_short
            pro_net_ce = pro_call_long - pro_call_short
            pro_net_pe = pro_put_long - pro_put_short

            client_net_fut = client_fut_long - client_fut_short
            client_net_ce = client_call_long - client_call_short
            client_net_pe = client_put_long - client_put_short

            dii_net_fut = dii_fut_long - dii_fut_short
            dii_net_ce = dii_call_long - dii_call_short
            dii_net_pe = dii_put_long - dii_put_short

            return {
                "date": report_date,
                "client_fut_long": client_fut_long,
                "client_fut_short": client_fut_short,
                "client_call_long": client_call_long,
                "client_call_short": client_call_short,
                "client_put_long": client_put_long,
                "client_put_short": client_put_short,
                "dii_fut_long": dii_fut_long,
                "dii_fut_short": dii_fut_short,
                "dii_call_long": dii_call_long,
                "dii_call_short": dii_call_short,
                "dii_put_long": dii_put_long,
                "dii_put_short": dii_put_short,
                "fii_fut_long": fii_fut_long,
                "fii_fut_short": fii_fut_short,
                "fii_call_long": fii_call_long,
                "fii_call_short": fii_call_short,
                "fii_put_long": fii_put_long,
                "fii_put_short": fii_put_short,
                "pro_fut_long": pro_fut_long,
                "pro_fut_short": pro_fut_short,
                "pro_call_long": pro_call_long,
                "pro_call_short": pro_call_short,
                "pro_put_long": pro_put_long,
                "pro_put_short": pro_put_short,
                "total_fut_oi": total_fut_oi,
                "total_call_oi": total_call_oi,
                "total_put_oi": total_put_oi,
                "fii_net_fut": fii_net_fut,
                "fii_net_ce": fii_net_ce,
                "fii_net_pe": fii_net_pe,
                "fii_long_short_ratio": fii_ratio,
                "pro_net_fut": pro_net_fut,
                "pro_net_ce": pro_net_ce,
                "pro_net_pe": pro_net_pe,
                "client_net_fut": client_net_fut,
                "client_net_ce": client_net_ce,
                "client_net_pe": client_net_pe,
                "dii_net_fut": dii_net_fut,
                "dii_net_ce": dii_net_ce,
                "dii_net_pe": dii_net_pe,
            }
        except Exception as e:
            logger.error("Failed to parse participant CSV for %s: %s", report_date, e)
            return None

    async def fetch_and_calculate_weights(
        self,
        target_date: Optional[date] = None,
        alpha: Optional[float] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Fetch NSE participant OI CSV for the given date, compute dealer weights,
        and store in both DealerWeight and ParticipantOIDaily tables.
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

            parsed = self.parse_participant_csv(response.text, actual_date)
            if not parsed:
                return None

            # Calculate dynamic alpha if not specified
            alpha_metrics = None
            if alpha is None:
                alpha_metrics = self.calculate_dynamic_alpha(
                    fii_fut_long=parsed["fii_fut_long"],
                    fii_fut_short=parsed["fii_fut_short"],
                    fii_call_long=parsed["fii_call_long"],
                    fii_call_short=parsed["fii_call_short"],
                    fii_put_long=parsed["fii_put_long"],
                    fii_put_short=parsed["fii_put_short"],
                    dte=3,
                    fallback_alpha=settings.dealer_alpha,
                )
                alpha = alpha_metrics["alpha_t"]

            # Dealer net positioning ratio (ω)
            total_call_oi = parsed["total_call_oi"]
            total_put_oi = parsed["total_put_oi"]
            omega_ce = float(
                (parsed["pro_net_ce"] + alpha * parsed["fii_net_ce"]) / total_call_oi
            ) if total_call_oi > 0 else 0.0

            omega_pe = float(
                (parsed["pro_net_pe"] + alpha * parsed["fii_net_pe"]) / total_put_oi
            ) if total_put_oi > 0 else 0.0

            # 1. Upsert into DealerWeight
            dw_stmt = insert(DealerWeight).values(
                date=actual_date,
                omega_ce=omega_ce,
                omega_pe=omega_pe,
                alpha=alpha,
                pro_call_long=parsed["pro_call_long"],
                pro_call_short=parsed["pro_call_short"],
                fii_call_long=parsed["fii_call_long"],
                fii_call_short=parsed["fii_call_short"],
                pro_put_long=parsed["pro_put_long"],
                pro_put_short=parsed["pro_put_short"],
                fii_put_long=parsed["fii_put_long"],
                fii_put_short=parsed["fii_put_short"],
                total_call_oi=total_call_oi,
                total_put_oi=total_put_oi,
            )
            dw_stmt = dw_stmt.on_conflict_do_update(
                constraint="uq_dealer_weights_date",
                set_={
                    "omega_ce": dw_stmt.excluded.omega_ce,
                    "omega_pe": dw_stmt.excluded.omega_pe,
                    "alpha": dw_stmt.excluded.alpha,
                    "pro_call_long": dw_stmt.excluded.pro_call_long,
                    "pro_call_short": dw_stmt.excluded.pro_call_short,
                    "fii_call_long": dw_stmt.excluded.fii_call_long,
                    "fii_call_short": dw_stmt.excluded.fii_call_short,
                    "pro_put_long": dw_stmt.excluded.pro_put_long,
                    "pro_put_short": dw_stmt.excluded.pro_put_short,
                    "fii_put_long": dw_stmt.excluded.fii_put_long,
                    "fii_put_short": dw_stmt.excluded.fii_put_short,
                    "total_call_oi": dw_stmt.excluded.total_call_oi,
                    "total_put_oi": dw_stmt.excluded.total_put_oi,
                },
            )
            await self.db.execute(dw_stmt)

            # 2. Upsert into ParticipantOIDaily
            p_stmt = insert(ParticipantOIDaily).values(**parsed)
            p_stmt = p_stmt.on_conflict_do_update(
                constraint="uq_participant_oi_daily_date",
                set_={col: p_stmt.excluded[col] for col in parsed if col != "date"},
            )
            await self.db.execute(p_stmt)
            await self.db.commit()

            result = {
                "date": actual_date.isoformat(),
                "omega_ce": round(omega_ce, 6),
                "omega_pe": round(omega_pe, 6),
                "alpha": alpha,
                "fii_long_short_ratio": parsed["fii_long_short_ratio"],
                "pro_call_net": parsed["pro_net_ce"],
                "fii_call_net": parsed["fii_net_ce"],
                "pro_put_net": parsed["pro_net_pe"],
                "fii_put_net": parsed["fii_net_pe"],
                "total_call_oi": total_call_oi,
                "total_put_oi": total_put_oi,
                "fii_regime": alpha_metrics.get("fii_regime", "MARKET_MAKER") if alpha_metrics else "MARKET_MAKER",
                "hedging_ratio_ht": alpha_metrics.get("hedging_ratio_ht", 0.50) if alpha_metrics else 0.50,
            }

            logger.info("✅ Participant OI & Dealer weights updated: ω_CE=%.4f, ω_PE=%.4f, FII_L/S=%.2f%% (date=%s)",
                         omega_ce, omega_pe, parsed["fii_long_short_ratio"] * 100, actual_date)
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

    async def backfill_historical_participant_oi(
        self,
        start_date: date = date(2026, 1, 1),
        end_date: Optional[date] = None,
        concurrency: int = 5,
    ) -> Dict[str, Any]:
        """
        Backfills historical participant OI from NSE Archives from start_date to end_date.
        Iterates day-by-day, gracefully skipping weekends/holidays (HTTP 404),
        and upserting all available trading days into participant_oi_daily.
        """
        if end_date is None:
            end_date = date.today()

        if start_date > end_date:
            return {"success": False, "error": f"start_date {start_date} is after end_date {end_date}"}

        # Generate weekday list (skipping Sat=5, Sun=6)
        cur_date = start_date
        all_dates = []
        while cur_date <= end_date:
            if cur_date.weekday() < 5:
                all_dates.append(cur_date)
            cur_date += timedelta(days=1)

        logger.info("Starting historical participant backfill: %d weekdays from %s to %s",
                    len(all_dates), start_date, end_date)

        sem = asyncio.Semaphore(concurrency)
        total_ingested = 0
        total_skipped = 0
        errors = 0

        async with httpx.AsyncClient(timeout=15.0) as client:
            for d in all_dates:
                date_str = d.strftime("%d%m%Y")
                url = self.BASE_URL.format(date_str=date_str)
                try:
                    async with sem:
                        resp = await client.get(url, headers=self.HEADERS)

                    if resp.status_code == 200:
                        parsed = self.parse_participant_csv(resp.text, d)
                        if parsed:
                            # 1. Upsert into ParticipantOIDaily
                            p_stmt = insert(ParticipantOIDaily).values(**parsed)
                            p_stmt = p_stmt.on_conflict_do_update(
                                constraint="uq_participant_oi_daily_date",
                                set_={col: p_stmt.excluded[col] for col in parsed if col != "date"},
                            )
                            await self.db.execute(p_stmt)

                            # 2. Also ensure DealerWeight exists for this historical day
                            total_call_oi = parsed["total_call_oi"]
                            total_put_oi = parsed["total_put_oi"]
                            omega_ce = float((parsed["pro_net_ce"] + 0.5 * parsed["fii_net_ce"]) / total_call_oi) if total_call_oi > 0 else 0.0
                            omega_pe = float((parsed["pro_net_pe"] + 0.5 * parsed["fii_net_pe"]) / total_put_oi) if total_put_oi > 0 else 0.0

                            dw_stmt = insert(DealerWeight).values(
                                date=d,
                                omega_ce=omega_ce,
                                omega_pe=omega_pe,
                                alpha=0.5,
                                pro_call_long=parsed["pro_call_long"],
                                pro_call_short=parsed["pro_call_short"],
                                fii_call_long=parsed["fii_call_long"],
                                fii_call_short=parsed["fii_call_short"],
                                pro_put_long=parsed["pro_put_long"],
                                pro_put_short=parsed["pro_put_short"],
                                fii_put_long=parsed["fii_put_long"],
                                fii_put_short=parsed["fii_put_short"],
                                total_call_oi=total_call_oi,
                                total_put_oi=total_put_oi,
                            )
                            dw_stmt = dw_stmt.on_conflict_do_update(
                                constraint="uq_dealer_weights_date",
                                set_={"omega_ce": dw_stmt.excluded.omega_ce, "omega_pe": dw_stmt.excluded.omega_pe}
                            )
                            await self.db.execute(dw_stmt)
                            total_ingested += 1
                        else:
                            total_skipped += 1
                    elif resp.status_code == 404:
                        total_skipped += 1
                    else:
                        errors += 1
                except Exception as e:
                    logger.debug("Backfill fetch failed for %s: %s", d, e)
                    errors += 1

                # Periodically commit to DB
                if total_ingested > 0 and total_ingested % 25 == 0:
                    await self.db.commit()

            await self.db.commit()

        logger.info("✅ Historical participant backfill complete: %d ingested, %d skipped/holidays, %d errors",
                    total_ingested, total_skipped, errors)
        return {
            "success": True,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "weekdays_checked": len(all_dates),
            "ingested": total_ingested,
            "skipped_or_holidays": total_skipped,
            "errors": errors,
        }

    @staticmethod
    async def get_participant_history(
        db: AsyncSession,
        start_date: Optional[date] = None,
        limit: int = 250,
    ) -> List[Dict[str, Any]]:
        """
        Returns chronological historical participant records for interactive time-series line charts.
        """
        stmt = select(ParticipantOIDaily)
        if start_date:
            stmt = stmt.where(ParticipantOIDaily.date >= start_date)
        stmt = stmt.order_by(ParticipantOIDaily.date.asc()).limit(limit)

        result = await db.execute(stmt)
        rows = result.scalars().all()

        history = []
        for r in rows:
            history.append({
                "date": r.date.isoformat(),
                "fii": {
                    "fut_long": r.fii_fut_long,
                    "fut_short": r.fii_fut_short,
                    "net_fut": r.fii_net_fut,
                    "call_long": r.fii_call_long,
                    "call_short": r.fii_call_short,
                    "net_ce": r.fii_net_ce,
                    "put_long": r.fii_put_long,
                    "put_short": r.fii_put_short,
                    "net_pe": r.fii_net_pe,
                    "long_short_ratio": float(r.fii_long_short_ratio) if r.fii_long_short_ratio is not None else 0.5,
                },
                "pro": {
                    "fut_long": r.pro_fut_long,
                    "fut_short": r.pro_fut_short,
                    "net_fut": r.pro_net_fut,
                    "call_long": r.pro_call_long,
                    "call_short": r.pro_call_short,
                    "net_ce": r.pro_net_ce,
                    "put_long": r.pro_put_long,
                    "put_short": r.pro_put_short,
                    "net_pe": r.pro_net_pe,
                },
                "client": {
                    "fut_long": r.client_fut_long,
                    "fut_short": r.client_fut_short,
                    "net_fut": r.client_net_fut,
                    "call_long": r.client_call_long,
                    "call_short": r.client_call_short,
                    "net_ce": r.client_net_ce,
                    "put_long": r.client_put_long,
                    "put_short": r.client_put_short,
                    "net_pe": r.client_net_pe,
                },
                "dii": {
                    "fut_long": r.dii_fut_long,
                    "fut_short": r.dii_fut_short,
                    "net_fut": r.dii_net_fut,
                    "call_long": r.dii_call_long,
                    "call_short": r.dii_call_short,
                    "net_ce": r.dii_net_ce,
                    "put_long": r.dii_put_long,
                    "put_short": r.dii_put_short,
                    "net_pe": r.dii_net_pe,
                },
                "total_call_oi": r.total_call_oi,
                "total_put_oi": r.total_put_oi,
                "total_fut_oi": r.total_fut_oi,
            })
        return history

    @staticmethod
    async def get_daily_eod_summary(db: AsyncSession) -> Optional[Dict[str, Any]]:
        """
        Returns the latest EOD update card metrics:
        Compares today's positions vs previous trading day to compute ΔOI, FII L/S ratio, and regime.
        """
        stmt = (
            select(ParticipantOIDaily)
            .order_by(desc(ParticipantOIDaily.date))
            .limit(2)
        )
        result = await db.execute(stmt)
        rows = result.scalars().all()

        if not rows:
            return None

        today = rows[0]
        prev = rows[1] if len(rows) > 1 else None

        def calc_delta(curr_val, prev_val):
            return int(curr_val - prev_val) if prev else 0

        # Quant sentiment evaluation from FII Long/Short Futures Ratio
        fii_ratio = float(today.fii_long_short_ratio or 0.5)
        if fii_ratio >= 0.70:
            regime = "EXTREME_BULLISH"
            regime_label = "Extreme Bullish"
            regime_color = "#10B981"
        elif fii_ratio >= 0.55:
            regime = "MODERATE_BULLISH"
            regime_label = "Moderate Bullish"
            regime_color = "#34D399"
        elif fii_ratio <= 0.30:
            regime = "EXTREME_BEARISH"
            regime_label = "Extreme Bearish"
            regime_color = "#EF4444"
        elif fii_ratio <= 0.45:
            regime = "MODERATE_BEARISH"
            regime_label = "Moderate Bearish"
            regime_color = "#F87171"
        else:
            regime = "NEUTRAL"
            regime_label = "Neutral / Balanced"
            regime_color = "#F59E0B"

        d_fii_fut = calc_delta(today.fii_net_fut, prev.fii_net_fut if prev else 0)
        d_fii_ce = calc_delta(today.fii_net_ce, prev.fii_net_ce if prev else 0)
        d_fii_pe = calc_delta(today.fii_net_pe, prev.fii_net_pe if prev else 0)
        d_client_ce = calc_delta(today.client_net_ce, prev.client_net_ce if prev else 0)

        commentary_parts = []
        if d_fii_fut > 5000:
            commentary_parts.append(f"FII added {d_fii_fut:+,} Net Futures (Long Accumulation)")
        elif d_fii_fut < -5000:
            commentary_parts.append(f"FII trimmed {d_fii_fut:+,} Net Futures (Short Buildup/Unwinding)")

        if d_fii_pe > 10000:
            commentary_parts.append(f"FII bought {d_fii_pe:+,} Net Puts (Downside Hedge)")
        elif d_fii_ce > 10000:
            commentary_parts.append(f"FII added {d_fii_ce:+,} Net Calls")

        if d_client_ce < -20000:
            commentary_parts.append(f"Retail heavily wrote Calls ({d_client_ce:+,} Net)")

        commentary = "; ".join(commentary_parts) if commentary_parts else "Positions remained largely balanced with routine intraday rollover."

        return {
            "date": today.date.isoformat(),
            "previous_date": prev.date.isoformat() if prev else None,
            "fii_long_short_ratio": round(fii_ratio, 4),
            "fii_long_short_pct": round(fii_ratio * 100, 2),
            "sentiment_regime": regime,
            "sentiment_label": regime_label,
            "sentiment_color": regime_color,
            "commentary": commentary,
            "today": {
                "fii": {
                    "net_fut": today.fii_net_fut,
                    "net_ce": today.fii_net_ce,
                    "net_pe": today.fii_net_pe,
                    "delta_fut": d_fii_fut,
                    "delta_ce": d_fii_ce,
                    "delta_pe": d_fii_pe,
                },
                "pro": {
                    "net_fut": today.pro_net_fut,
                    "net_ce": today.pro_net_ce,
                    "net_pe": today.pro_net_pe,
                    "delta_fut": calc_delta(today.pro_net_fut, prev.pro_net_fut if prev else 0),
                    "delta_ce": calc_delta(today.pro_net_ce, prev.pro_net_ce if prev else 0),
                    "delta_pe": calc_delta(today.pro_net_pe, prev.pro_net_pe if prev else 0),
                },
                "client": {
                    "net_fut": today.client_net_fut,
                    "net_ce": today.client_net_ce,
                    "net_pe": today.client_net_pe,
                    "delta_fut": calc_delta(today.client_net_fut, prev.client_net_fut if prev else 0),
                    "delta_ce": calc_delta(today.client_net_ce, prev.client_net_ce if prev else 0),
                    "delta_pe": calc_delta(today.client_net_pe, prev.client_net_pe if prev else 0),
                },
                "dii": {
                    "net_fut": today.dii_net_fut,
                    "net_ce": today.dii_net_ce,
                    "net_pe": today.dii_net_pe,
                    "delta_fut": calc_delta(today.dii_net_fut, prev.dii_net_fut if prev else 0),
                    "delta_ce": calc_delta(today.dii_net_ce, prev.dii_net_ce if prev else 0),
                    "delta_pe": calc_delta(today.dii_net_pe, prev.dii_net_pe if prev else 0),
                },
            }
        }

