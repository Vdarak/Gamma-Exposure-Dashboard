import httpx
import random
import asyncio
from datetime import datetime, date, timezone
from typing import Optional, Dict, Any
from app.services.ingestion.normalizer import NormalizedSnapshot, OptionContract

class CBOEScraperService:
    """
    US market CBOE delayed options chain data scraper.
    """
    def __init__(self):
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "DNT": "1",
            "Connection": "keep-alive",
            "Referer": "https://www.cboe.com/",
            "Origin": "https://www.cboe.com",
            "Sec-CH-UA": '"Not A(Brand";v="99", "Google Chrome";v="131", "Chromium";v="131"',
            "Sec-CH-UA-Mobile": "?0",
            "Sec-CH-UA-Platform": '"macOS"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        }

    async def fetch_cboe_raw(self, ticker: str) -> Optional[Dict[str, Any]]:
        """
        Fetch CBOE raw JSON with retries and alternate URL routing on 403.
        """
        max_retries = 4
        for attempt in range(1, max_retries + 1):
            req_id = "".join(random.choices("abcdefghijklmnopqrstuvwxyz0123456789", k=9))
            url = f"https://cdn.cboe.com/api/global/delayed_quotes/options/{ticker}.json?_={req_id}"
            
            print(f"   [CBOE {ticker}] Attempt {attempt}/{max_retries}: {url}")
            
            try:
                async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
                    response = await client.get(url, headers=self.headers)
                    
                if response.status_code == 403:
                    print(f"   [CBOE {ticker}] ❌ CloudFront 403 - Trying fallback URL...")
                    fallback_url = f"https://cdn.cboe.com/api/global/delayed_quotes/options/_{ticker}.json?_={req_id}"
                    
                    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
                        response = await client.get(fallback_url, headers=self.headers)
                        
                    if response.status_code == 200:
                        print(f"   [CBOE {ticker}] ✅ Fallback URL succeeded!")
                        data = response.json()
                        return data.get("data", data)
                        
                    if attempt < max_retries:
                        await asyncio.sleep(min(3 * attempt, 15))
                        continue
                    return None

                if response.status_code != 200:
                    print(f"   [CBOE {ticker}] ❌ HTTP status {response.status_code}")
                    if attempt < max_retries:
                        await asyncio.sleep(min(3 * attempt, 15))
                        continue
                    return None

                data = response.json()
                print(f"   [CBOE {ticker}] ✅ Successfully fetched data.")
                return data.get("data", data)

            except Exception as e:
                print(f"   [CBOE {ticker}] ❌ Attempt {attempt} error: {e}")
                if attempt == max_retries:
                    return None
                await asyncio.sleep(min(3 * attempt, 15))
                
        return None

    async def get_normalized_snapshot(self, ticker: str) -> Optional[NormalizedSnapshot]:
        """
        Fetch CBOE option chain and return a NormalizedSnapshot model.
        """
        raw_data = await self.fetch_cboe_raw(ticker)
        if not raw_data or "options" not in raw_data:
            return None

        # Resolve spot price
        current_price = raw_data.get("current_price") or raw_data.get("price") or 0.0
        if current_price == 0.0 and len(raw_data["options"]) > 0:
            # Fallback to nearest ATM strike if spot price not directly given
            # We can use the spot price from the first option contract's underlying (if available)
            pass

        options_list = []
        for opt in raw_data["options"]:
            strike = opt.get("strike", 0.0)
            opt_type_raw = opt.get("option_type", "").lower()
            opt_type = "C" if opt_type_raw == "call" or opt_type_raw == "c" else "P"
            
            exp_date_str = opt.get("expiration_date")
            if not exp_date_str:
                # Parse from option symbol (OSI format: AAPL260116C00150000)
                # Matches ticker + YYMMDD + C/P + strike
                symbol = opt.get("option", "")
                import re
                match = re.match(r"^([A-Z]+)(\d{6})([CP])(\d{8})$", symbol)
                if match:
                    _, yymmdd, cp, strike_code = match.groups()
                    opt_type = cp
                    strike = float(strike_code) / 1000.0
                    exp_date_str = f"20{yymmdd[0:2]}-{yymmdd[2:4]}-{yymmdd[4:6]}"
                else:
                    continue

            try:
                exp_date = datetime.strptime(exp_date_str, "%Y-%m-%d").date()
            except ValueError:
                continue

            contract = OptionContract(
                strike=strike,
                option_type=opt_type,
                expiration=exp_date,
                last_price=opt.get("last") or opt.get("last_trade_price") or 0.0,
                bid=opt.get("bid") or 0.0,
                ask=opt.get("ask") or 0.0,
                volume=opt.get("volume") or 0,
                open_interest=opt.get("open_interest") or 0,
                implied_volatility=opt.get("iv") or 0.0,
                delta=opt.get("delta") or 0.0,
                gamma=opt.get("gamma") or 0.0,
                theta=opt.get("theta") or 0.0,
                vega=opt.get("vega") or 0.0,
                rho=opt.get("rho") or 0.0
            )
            options_list.append(contract)

        if not options_list:
            return None

        # Build normalized snapshot
        snap = NormalizedSnapshot(
            ticker=ticker,
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            spot_price=float(current_price),
            market="USA",
            options=options_list
        )
        return snap
