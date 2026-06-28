import httpx
import asyncio
from datetime import datetime, date, timezone
from typing import Optional, List, Dict, Any
from app.services.ingestion.normalizer import NormalizedSnapshot, OptionContract
from app.config import settings

class NSELiveScraperService:
    """
    India market live NSE option chain scraper.
    """
    def __init__(self):
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        }
        self.api_headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Referer": "https://www.nseindia.com/option-chain",
            "Origin": "https://www.nseindia.com",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "X-Requested-With": "XMLHttpRequest",
            "Connection": "keep-alive",
        }
        self.index_symbols = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"}

    async def get_normalized_snapshot(self, ticker: str) -> Optional[NormalizedSnapshot]:
        """
        Scrapes option chain from NSE REST API for all expiries up to maximum cap.
        """
        max_retries = 3
        is_index = ticker.upper() in self.index_symbols
        type_param = "Indices" if is_index else "Equity"
        
        # Max expiries to scrape (defaults to 1 or 2 to save rate limit and time)
        max_expiries = 2
        raw_cap = settings.nse_max_expiries
        if raw_cap and raw_cap.isdigit():
            max_expiries = int(raw_cap)
        elif raw_cap == "all":
            max_expiries = 99
            
        print(f"   [NSE {ticker}] Scrapes starting. Max expiries: {max_expiries}")

        # Use an AsyncClient to automatically maintain session cookies
        async with httpx.AsyncClient(timeout=15.0, headers=self.headers) as client:
            for attempt in range(1, max_retries + 1):
                try:
                    # Step 1: Hit main page to fetch cookies
                    print(f"   [NSE {ticker}] Step 1: Getting session cookies (Attempt {attempt})...")
                    r_home = await client.get("https://www.nseindia.com/option-chain")
                    if r_home.status_code != 200:
                        print(f"   [NSE {ticker}] ❌ Failed to fetch home page: HTTP {r_home.status_code}")
                        await asyncio.sleep(2)
                        continue
                        
                    # Wait to mimic human browser
                    await asyncio.sleep(2)
                    
                    # Step 2: Fetch contract-info for expiry dates
                    info_url = f"https://www.nseindia.com/api/option-chain-contract-info?symbol={ticker}"
                    print(f"   [NSE {ticker}] Step 2: Requesting expiries info: {info_url}")
                    r_info = await client.get(info_url, headers=self.api_headers)
                    
                    if r_info.status_code != 200:
                        print(f"   [NSE {ticker}] ❌ Failed to get contract-info: HTTP {r_info.status_code}")
                        await asyncio.sleep(2)
                        continue
                        
                    info_data = r_info.json()
                    expiry_dates = info_data.get("expiryDates") or info_data.get("records", {}).get("expiryDates") or []
                    
                    if not expiry_dates:
                        print(f"   [NSE {ticker}] ❌ No expiry dates returned.")
                        await asyncio.sleep(2)
                        continue
                        
                    # Select limited expiries
                    selected_expiries = expiry_dates[:max_expiries]
                    print(f"   [NSE {ticker}] Found {len(expiry_dates)} expiries, scraping top {len(selected_expiries)}: {selected_expiries}")
                    
                    # Step 3: Fetch options for selected expiries
                    combined_contracts = []
                    spot_price = 0.0
                    
                    for expiry in selected_expiries:
                        await asyncio.sleep(0.5 + random.random() * 0.5)
                        v3_url = f"https://www.nseindia.com/api/option-chain-v3?type={type_param}&symbol={ticker}&expiry={expiry}"
                        print(f"   [NSE {ticker}] Step 3: Scraping v3 for expiry {expiry}: {v3_url}")
                        
                        r_v3 = await client.get(v3_url, headers=self.api_headers)
                        if r_v3.status_code != 200:
                            print(f"   [NSE {ticker}] ⚠️ Failed to fetch v3 for {expiry} (HTTP {r_v3.status_code})")
                            continue
                            
                        v3_data = r_v3.json()
                        rows = v3_data.get("data") or v3_data.get("records", {}).get("data") or []
                        
                        # Fetch spot price
                        if spot_price == 0.0:
                            spot_price = float(v3_data.get("underlyingValue") or v3_data.get("records", {}).get("underlyingValue") or 0.0)
                            
                        # Normalize contracts
                        for row in rows:
                            strike = float(row.get("strikePrice", 0.0))
                            
                            # Parse CE and PE legs
                            for leg_key, leg_type in [("CE", "C"), ("PE", "P")]:
                                leg = row.get(leg_key)
                                if not leg:
                                    continue
                                    
                                # Find spot price if not resolved yet
                                if spot_price == 0.0 and leg.get("underlyingValue"):
                                    spot_price = float(leg["underlyingValue"])
                                    
                                exp_str = leg.get("expiryDate")
                                if not exp_str:
                                    continue
                                    
                                try:
                                    exp_date = datetime.strptime(exp_str, "%d-%b-%Y").date()
                                except ValueError:
                                    continue
                                    
                                contract = OptionContract(
                                    strike=strike,
                                    option_type=leg_type,
                                    expiration=exp_date,
                                    last_price=float(leg.get("lastPrice", 0.0)),
                                    bid=float(leg.get("bidprice", 0.0)),
                                    ask=float(leg.get("askPrice", 0.0)),
                                    volume=int(leg.get("totalTradedVolume", 0)),
                                    open_interest=int(leg.get("openInterest", 0)),
                                    implied_volatility=float(leg.get("impliedVolatility", 0.0)) / 100.0, # convert % to decimal
                                    change_in_oi=int(leg.get("changeinOpenInterest", 0)),
                                    total_buy_qty=int(leg.get("totalBuyQuantity", 0)),
                                    total_sell_qty=int(leg.get("totalSellQuantity", 0))
                                )
                                combined_contracts.append(contract)
                                
                    if not combined_contracts:
                        print(f"   [NSE {ticker}] ❌ Scraping completed but no contracts normalized.")
                        await asyncio.sleep(2)
                        continue
                        
                    print(f"   [NSE {ticker}] ✅ Success! Scraping normalized {len(combined_contracts)} contracts. Spot: {spot_price}")
                    
                    # Deduplicate overlapping contracts
                    unique_map = {}
                    for c in combined_contracts:
                        key = f"{c.strike}_{c.option_type}_{c.expiration}"
                        unique_map[key] = c
                        
                    snap = NormalizedSnapshot(
                        ticker=ticker,
                        timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
                        spot_price=spot_price,
                        market="IND",
                        options=list(unique_map.values())
                    )
                    return snap
                    
                except Exception as e:
                    print(f"   [NSE {ticker}] ❌ Attempt {attempt} error: {e}")
                    if attempt == max_retries:
                        return None
                    await asyncio.sleep(min(5 * attempt, 15))
                    
        return None
