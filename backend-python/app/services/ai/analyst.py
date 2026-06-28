import os
import json
import logging
from datetime import datetime, date
from typing import Dict, Any, List, Optional
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, text
from google import genai
from google.genai import types

from app.config import settings
from app.models.journal import JournalTrade
from app.services.data_retrieval import DataRetrievalService

logger = logging.getLogger("gamma-exposure-backend.ai.analyst")

class AIAnalystService:
    def __init__(self):
        self.api_key = settings.gemini_api_key
        if self.api_key:
            self.client = genai.Client(api_key=self.api_key)
        else:
            self.client = None
            logger.warning("Gemini API key is missing. AIAnalystService will be disabled.")

    def is_enabled(self) -> bool:
        return self.client is not None

    async def generate_briefing(self, db: AsyncSession, ticker: str, timeframe: str = "Intraday") -> str:
        """Generates a structured market briefing focused on GEX/VEX/Vanna/Charm landscape."""
        if not self.is_enabled():
            return "AI Analyst is not configured. Please add GEMINI_API_KEY to your environment variables."

        try:
            logger.info(f"Gathering full GEX snapshot for {ticker} briefing...")
            retrieval = DataRetrievalService(db)
            current_snap = await retrieval.get_current_data(ticker)
            
            if not current_snap or not current_snap.get("options"):
                return f"No live option snapshot found for {ticker}. Ensure the data ingestion pipeline is running."

            spot = current_snap["spotPrice"]
            options = current_snap["options"]
            today_str = date.today().isoformat()

            # Compile strikes statistics
            strike_map = {}
            total_gex = 0.0
            total_vanna = 0.0
            total_charm = 0.0
            expiry_totals = {}

            for opt in options:
                exp_val = opt["expiration"]
                exp_str = exp_val.isoformat() if isinstance(exp_val, (date, datetime)) else str(exp_val).split("T")[0]
                
                try:
                    exp_date = datetime.strptime(exp_str, "%Y-%m-%d").date()
                except Exception:
                    exp_date = date.today()
                    
                dte = max(0, (exp_date - date.today()).days)
                strike = float(opt["strike"])
                gamma = float(opt.get("gamma") or 0.0)
                oi = int(opt.get("openInterest") or 0)
                delta = float(opt.get("delta") or 0.0)
                theta = float(opt.get("theta") or 0.0)
                vega = float(opt.get("vega") or 0.0)
                iv = float(opt.get("impliedVolatility") or 0.0)
                volume = int(opt.get("volume") or 0)
                
                sign = 1.0 if opt["type"] == "C" else -1.0
                gex = sign * spot * spot * gamma * oi / 1e9
                vanna = vega * delta
                charm = delta * theta
                
                total_gex += gex
                total_vanna += vanna
                total_charm += charm

                # Expiry aggregates
                exp_t = expiry_totals.get(exp_str, {"netGex": 0.0, "totalVanna": 0.0, "totalCharm": 0.0, "count": 0})
                exp_t["netGex"] += gex
                exp_t["totalVanna"] += vanna
                exp_t["totalCharm"] += charm
                exp_t["count"] += 1
                expiry_totals[exp_str] = exp_t

                key = f"{strike}_{exp_str}"
                cur = strike_map.get(key, {
                    "strike": strike, "expiration": exp_str, "dte": dte,
                    "callGex": 0.0, "putGex": 0.0, "netGex": 0.0,
                    "callOI": 0, "putOI": 0, "callVanna": 0.0, "putVanna": 0.0,
                    "callCharm": 0.0, "putCharm": 0.0, "callIV": 0.0, "putIV": 0.0,
                    "callVolume": 0, "putVolume": 0
                })
                
                if opt["type"] == "C":
                    cur["callGex"] += gex
                    cur["callOI"] += oi
                    cur["callVanna"] += vanna
                    cur["callCharm"] += charm
                    cur["callIV"] = iv
                    cur["callVolume"] += volume
                else:
                    cur["putGex"] += gex
                    cur["putOI"] += oi
                    cur["putVanna"] += vanna
                    cur["putCharm"] += charm
                    cur["putIV"] = iv
                    cur["putVolume"] += volume
                    
                cur["netGex"] = cur["callGex"] + cur["putGex"]
                strike_map[key] = cur

            all_strikes = list(strike_map.values())
            
            # 0DTE landscape
            zdte_strikes = sorted([s for s in all_strikes if s["dte"] == 0], key=lambda x: abs(x["netGex"]), reverse=True)
            zdte_net_gex = sum(s["netGex"] for s in zdte_strikes)
            zdte_vanna = sum(s["callVanna"] + s["putVanna"] for s in zdte_strikes)
            zdte_charm = sum(s["callCharm"] + s["putCharm"] for s in zdte_strikes)
            
            top_0dte = [{
                "strike": s["strike"],
                "netGex": f"{s['netGex']:.4f}B",
                "callOI": s["callOI"],
                "putOI": s["putOI"],
                "callIV": f"{s['callIV'] * 100:.1f}%",
                "putIV": f"{s['putIV'] * 100:.1f}%",
                "type": "CALL WALL (support)" if s["netGex"] >= 0 else "PUT WALL (resistance)"
            } for s in zdte_strikes[:8]]

            # Gamma Flip
            near_spot = sorted([s for s in all_strikes if abs(s["strike"] - spot) / spot < 0.05], key=lambda x: abs(x["strike"] - spot))
            gamma_flip = None
            for i in range(len(near_spot) - 1):
                a, b = near_spot[i], near_spot[i+1]
                if (a["netGex"] >= 0 and b["netGex"] < 0) or (a["netGex"] < 0 and b["netGex"] >= 0):
                    t = abs(a["netGex"]) / (abs(a["netGex"]) + abs(b["netGex"])) if (abs(a["netGex"]) + abs(b["netGex"])) > 0 else 0.5
                    gamma_flip = a["strike"] + t * (b["strike"] - a["strike"])
                    break

            top_gamma = sorted(all_strikes, key=lambda x: abs(x["netGex"]), reverse=True)[:10]
            top_gamma_strikes = [{
                "strike": s["strike"], "expiry": s["expiration"], "dte": s["dte"],
                "netGex": f"{s['netGex']:.4f}B", "callOI": s["callOI"], "putOI": s["putOI"]
            } for s in top_gamma]

            expiry_breakdown = sorted([
                {
                    "expiry": exp,
                    "dte": max(0, (datetime.strptime(exp, "%Y-%m-%d").date() - date.today()).days),
                    "netGex": f"{t['netGex']:.4f}B",
                    "vannaNet": f"{t['totalVanna']:.4f}",
                    "charmNet": f"{t['totalCharm']:.4f}",
                    "contracts": t["count"]
                }
                for exp, t in expiry_totals.items()
            ], key=lambda x: x["dte"])[:6]

            context_payload = {
                "ticker": ticker,
                "timeframe": timeframe,
                "spot": f"{spot:.2f}",
                "snapshotTime": current_snap["timestamp"].isoformat(),
                "gammaFlip": f"{gamma_flip:.2f}" if gamma_flip else "Not found near spot (±5%)",
                "spotVsFlip": f"ABOVE flip +{spot - gamma_flip:.1f} pts → LONG GAMMA" if (gamma_flip and spot > gamma_flip) else f"BELOW flip -{gamma_flip - spot:.1f} pts → SHORT GAMMA" if gamma_flip else "Unknown",
                "totalGexAllExpiries": f"{total_gex:.4f}B",
                "netVanna": f"{total_vanna:.4f}",
                "netCharm": f"{total_charm:.4f}",
                "vannaSignal": "Positive — dealer delta expands on vol spike, upside self-amplifying" if total_vanna > 0 else "Negative — dealer delta contracts on vol spike, downside self-amplifying",
                "charmSignal": "Positive — delta bleeds long into EOD, gentle upward drift bias" if total_charm > 0 else "Negative — delta bleeds short into EOD, gentle downward drift bias",
                "zdteLandscape": {
                    "netGex": f"{zdte_net_gex:.4f}B",
                    "vanna": f"{zdte_vanna:.4f}",
                    "charm": f"{zdte_charm:.4f}",
                    "regime": "LONG GAMMA — dealers sell rallies / buy dips, expect pinning / mean reversion / low vol" if zdte_net_gex >= 0 else "SHORT GAMMA — dealers chase price, expect momentum / vol expansion / trending",
                    "top8Strikes": top_0dte
                },
                "expiryBreakdown": expiry_breakdown,
                "topGammaStrikes": top_gamma_strikes
            }

            system_prompt = f"""You are an elite 0DTE and GEX (Gamma Exposure) terminal analyst. You receive a full GEX snapshot with computed Vanna and Charm proxies, a 0DTE gamma landscape, and a gamma flip level.
Generate your briefing using these EXACT markdown sections (## headers):

## 0DTE Gamma Regime
State the 0DTE regime (Long or Short Gamma). Explain what this means for intraday dealer hedging behavior and expected price action character (pinning vs. trending).

## Core Gamma Levels
Present a clean markdown table of Key Levels (Spot Price, Gamma Flip Level, Call Wall, Put Wall) with short dealer hedging remarks.

## Greeks Heatmap (Vanna/Charm)
Analyze net Vanna and Charm. Explain the delta decay trajectory into EOD and volatility sensitivity effects.

## Trading Strategy Recommendation
Suggest an educational trade setup based on the regime: mean-reversion setups for Long Gamma, breakout setups for Short Gamma. Include an option spread idea specifying exact strikes from the top strikes.
Include the disclaimer: "FOR EDUCATIONAL PURPOSES ONLY. OPTION TRADING INVOLVES SUBSTANTIAL RISK."
"""

            response = self.client.models.generate_content(
                model="gemini-1.5-flash",
                contents=f"GEX Snapshot JSON:\n{json.dumps(context_payload, indent=2)}",
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.2
                )
            )
            return response.text or "Failed to generate AI briefing."
        except Exception as e:
            logger.error(f"Error generating GEX briefing: {e}", exc_info=True)
            return f"Error generating briefing: {str(e)}"

    async def parse_strategy(self, description: str) -> dict:
        """Parses a plain English strategy description into structured JSON parameters."""
        if not self.is_enabled():
            raise ValueError("Gemini API client is not configured.")

        system_prompt = """You are a professional algorithmic trading system developer. Your task is to convert a user's trading strategy described in natural language into a highly structured JSON configuration.
The output MUST be a JSON object matching this exact schema:
{
  "indicators": [
    {
      "type": "sma" | "ema" | "rsi" | "macd" | "bb" | "atr",
      "period1": number,
      "period2": number, // Optional (required for macd, default 26)
      "signalPeriod": number, // Optional (required for macd, default 9)
      "stdDev": number // Optional (required for bb, default 2)
    }
  ],
  "entryRules": {
    "indicators": [
      {
        "indicator1": string, // E.g. "close", "sma_200", "rsi_14"
        "operator": "greater_than" | "less_than" | "crosses_above" | "crosses_below" | "equals",
        "indicator2": string | number // E.g. "sma_50", 30
      }
    ]
  },
  "exitRules": {
    "stopLossPercent": number | null,
    "trailingStopPercent": number | null,
    "takeProfitPercent": number | null,
    "timeBasedExitDays": number | null,
    "indicators": [
      {
        "indicator1": string,
        "operator": "greater_than" | "less_than" | "crosses_above" | "crosses_below" | "equals",
        "indicator2": string | number
      }
    ]
  },
  "shouldExecute": boolean
}

Indicator key generation rules:
- Indicators in entry/exit rules must be strictly lowercase (e.g. "close", "rsi_14", "sma_50", "ema_200").
- Use "close", NOT "price".
- Output ONLY valid JSON starting with { and ending with }. Do not enclose in markdown code blocks.
"""
        try:
            response = self.client.models.generate_content(
                model="gemini-1.5-flash",
                contents=f"Description:\n{description}",
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.1
                )
            )
            text_res = response.text.strip()
            if text_res.startswith("```"):
                text_res = text_res.replace("```json", "").replace("```", "").strip()
            return json.loads(text_res)
        except Exception as e:
            logger.error(f"Error parsing strategy description: {e}")
            raise ValueError(f"Failed to parse strategy: {str(e)}")

    async def generate_pinescript(self, strategy_config: dict) -> str:
        """Generates TradingView PineScript v5 code matching the strategy configuration."""
        if not self.is_enabled():
            return "// AI Analyst is not configured. Please add GEMINI_API_KEY."

        system_prompt = """You are an expert TradingView Pine Script developer. Convert the provided strategy JSON configuration into a complete, clean, and compile-ready Pine Script v5 strategy.
Rules:
1. Output ONLY the raw Pine Script v5 code block. Do NOT surround it with markdown code fences (like ```pinescript).
2. The script must begin with `//@version=5` and `strategy(...)`.
3. Correctly declare user inputs for all indicators, periods, stop losses, and take profits.
4. Calculate indicators using standard Pine Script built-in functions: `ta.sma`, `ta.ema`, `ta.rsi`, `ta.macd`, `ta.atr`.
5. Implement entry and exit triggers according to the entryRules and exitRules comparison definitions.
6. Use `strategy.entry` and `strategy.close` for ordering. Include stop loss / take profit exits using `strategy.exit` if configured.
"""
        try:
            response = self.client.models.generate_content(
                model="gemini-1.5-flash",
                contents=f"Strategy Config JSON:\n{json.dumps(strategy_config, indent=2)}",
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.1
                )
            )
            code = response.text.strip()
            if code.startswith("```"):
                code = code.replace("```pinescript", "").replace("```pine", "").replace("```", "").strip()
            return code
        except Exception as e:
            logger.error(f"Error generating PineScript: {e}")
            return f"// Error generating PineScript: {str(e)}"

    async def process_chat(
        self,
        db: AsyncSession,
        message: str,
        history: List[Dict[str, str]] = None,
        ticker: str = "SPX",
        live_price: float = 0.0,
        ui_context: Any = None,
        is_0dte_mode: bool = False,
        option_data: List[dict] = None
    ) -> Dict[str, Any]:
        """Handles AI Analyst assistant conversations, including trade journaling tool executions."""
        if not self.is_enabled():
            return {"text": "AI Analyst is not configured. Please add GEMINI_API_KEY to your environment variables."}

        try:
            # 1. Reconstruct current option GEX context
            retrieval = DataRetrievalService(db)
            current_snap = None
            if not option_data:
                current_snap = await retrieval.get_current_data(ticker.upper())

            opts = option_data if option_data else (current_snap["options"] if current_snap else [])
            spot = live_price if live_price > 0 else (current_snap["spotPrice"] if current_snap else 0.0)

            # Compile GEX metrics summary
            gex_summary = None
            if opts and spot > 0:
                total_gex = 0.0
                zdte_net_gex = 0.0
                top_strikes = []
                today_str = date.today().isoformat()
                
                strike_map = {}
                for opt in opts:
                    exp_val = opt.get("expiration")
                    exp_str = exp_val.isoformat() if isinstance(exp_val, (date, datetime)) else str(exp_val).split("T")[0]
                    try:
                        exp_date = datetime.strptime(exp_str, "%Y-%m-%d").date()
                    except Exception:
                        exp_date = date.today()
                    dte = max(0, (exp_date - date.today()).days)
                    strike = float(opt["strike"])
                    gamma = float(opt.get("gamma") or 0.0)
                    oi = int(opt.get("openInterest") or 0)
                    sign = 1.0 if opt["type"] == "C" else -1.0
                    gex = sign * spot * spot * gamma * oi / 1e9
                    total_gex += gex
                    if dte == 0:
                        zdte_net_gex += gex
                    
                    key = f"{strike}_{exp_str}"
                    cur = strike_map.get(key, {"strike": strike, "netGex": 0.0, "callOI": 0, "putOI": 0})
                    cur["netGex"] += gex
                    if opt["type"] == "C":
                        cur["callOI"] += oi
                    else:
                        cur["putOI"] += oi
                    strike_map[key] = cur

                top_strikes = sorted(strike_map.values(), key=lambda x: abs(x["netGex"]), reverse=True)[:8]

                gex_summary = {
                    "totalGex": f"{total_gex:.4f}B",
                    "zdteNetGex": f"{zdte_net_gex:.4f}B",
                    "zdteRegime": "LONG GAMMA" if zdte_net_gex >= 0 else "SHORT GAMMA",
                    "top0DTEStrikes": [{
                        "strike": s["strike"], "netGex": f"{s['netGex']:.4f}B",
                        "callOI": s["callOI"], "putOI": s["putOI"]
                    } for s in top_strikes]
                }

            context_payload = {
                "ticker": ticker.upper(),
                "spotPrice": spot,
                "timestamp": datetime.utcnow().isoformat(),
                "gexSummary": gex_summary,
                "uiContext": ui_context,
                "is0DteModeActive": is_0dte_mode
            }

            # 2. Build Tools for Journal
            tool_declarations = [
                types.FunctionDeclaration(
                    name="log_trade",
                    description="Logs a single trade in the user's trading journal database.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "ticker": types.Schema(type=types.Type.STRING, description="The stock or option ticker symbol, e.g. SPY, TSLA, NIFTY"),
                            "tradeType": types.Schema(type=types.Type.STRING, description="Type of trade (Equity or Option)", enum=["Equity", "Option"]),
                            "strike": types.Schema(type=types.Type.NUMBER, description="Option strike price (leave empty for Equities)"),
                            "optionType": types.Schema(type=types.Type.STRING, description="Option type: C for Call, P for Put (leave empty for Equities)", enum=["C", "P"]),
                            "expiration": types.Schema(type=types.Type.STRING, description="Option expiration date in YYYY-MM-DD format (leave empty for Equities)"),
                            "direction": types.Schema(type=types.Type.STRING, description="Trade direction (Buy or Sell)", enum=["Buy", "Sell"]),
                            "quantity": types.Schema(type=types.Type.NUMBER, description="Quantity of shares or option contracts traded"),
                            "entryPrice": types.Schema(type=types.Type.NUMBER, description="Average entry price per share or contract"),
                            "exitPrice": types.Schema(type=types.Type.NUMBER, description="Average exit price per share or contract"),
                            "pnl": types.Schema(type=types.Type.NUMBER, description="Total profit and loss in dollars."),
                            "pnlPercent": types.Schema(type=types.Type.NUMBER, description="Percentage return on the trade (e.g. 15.5 for 15.5%)"),
                            "quality": types.Schema(type=types.Type.STRING, description="Grade of trade quality: S, A, B", enum=["S", "A", "B"]),
                            "rationale": types.Schema(type=types.Type.STRING, description="Trader's note/rationale"),
                            "strategy": types.Schema(type=types.Type.STRING, description="Strategy name, e.g. GEX Breakout")
                        },
                        required=["ticker", "tradeType", "direction", "quantity", "entryPrice", "exitPrice", "pnl", "pnlPercent", "quality"]
                    )
                ),
                types.FunctionDeclaration(
                    name="view_trades",
                    description="Retrieves a list of logged trades from the trading journal database.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "tradeDate": types.Schema(type=types.Type.STRING, description="The execution date of the trades to view (YYYY-MM-DD).")
                        }
                    )
                )
            ]

            # Reconstruct model history
            contents = []
            if history:
                for h in history:
                    role = "user" if h["role"] == "user" else "model"
                    contents.append(types.Content(role=role, parts=[types.Part.from_text(text=h["text"])]))
            contents.append(types.Content(role="user", parts=[types.Part.from_text(text=message)]))

            system_prompt = f"""You are an elite options market analyst and GEX/IV trading assistant.
You have DIRECT ACCESS to the live application-state and market context JSON payload provided below. Analyze it and answer directly.

=== LIVE DASHBOARD JSON CONTEXT ===
{json.dumps(context_payload, indent=2)}
=== END JSON CONTEXT ===

You are also equipped with tools for the user's trading journal:
- 'log_trade': Logs a single trade.
- 'view_trades': Retrieves logged trades.
"""

            response = self.client.models.generate_content(
                model="gemini-1.5-flash",
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    tools=[types.Tool(function_declarations=tool_declarations)],
                    temperature=0.3
                )
            )

            candidate = response.candidates[0]
            part = candidate.content.parts[0] if candidate.content.parts else None

            # Handle Function Call
            if part and part.function_call:
                call = part.function_call
                args = call.args

                if call.name == "log_trade":
                    # Log trade in DB
                    today_str = date.today().isoformat()
                    time_str = datetime.now().time().isoformat()[:5]

                    # Parse expiration date
                    exp_date = None
                    if args.get("expiration"):
                        try:
                            exp_date = datetime.strptime(args["expiration"], "%Y-%m-%d").date()
                        except Exception:
                            pass

                    # Insert trade
                    new_trade = JournalTrade(
                        trade_date=datetime.strptime(args.get("tradeDate", today_str), "%Y-%m-%d").date(),
                        time_entered=args.get("timeEntered", time_str),
                        time_exited=args.get("timeExited", time_str),
                        ticker=args["ticker"].upper(),
                        trade_type=args["tradeType"],
                        strike=Decimal(str(args["strike"])) if args.get("strike") else None,
                        option_type=args.get("optionType"),
                        expiration=exp_date,
                        direction=args["direction"],
                        quantity=Decimal(str(args["quantity"])),
                        entry_price=Decimal(str(args["entryPrice"])),
                        exit_price=Decimal(str(args["exitPrice"])),
                        pnl=Decimal(str(args["pnl"])),
                        pnl_percent=Decimal(str(args["pnlPercent"])),
                        quality=args["quality"],
                        rationale=args.get("rationale", "Logged via AI Analyst chat"),
                        strategy=args.get("strategy", "AI Logged"),
                        status="Closed"
                    )
                    db.add(new_trade)
                    await db.commit()
                    await db.refresh(new_trade)

                    details = f"{new_trade.direction} {new_trade.quantity} {new_trade.ticker} {new_trade.trade_type} at ${new_trade.entry_price} (Exit: ${new_trade.exit_price}, PnL: ${new_trade.pnl:.2f})"
                    return {
                        "text": f"✅ I have successfully logged the trade for you!\n\n**Details:** {details}\n**Grade:** {new_trade.quality}\n**Rationale:** {new_trade.rationale}",
                        "tradeLogged": {
                            "id": new_trade.id,
                            "ticker": new_trade.ticker,
                            "tradeType": new_trade.trade_type,
                            "direction": new_trade.direction,
                            "pnl": float(new_trade.pnl)
                        }
                    }

                elif call.name == "view_trades":
                    target_d = args.get("tradeDate")
                    stmt = select(JournalTrade)
                    if target_d:
                        try:
                            d_val = datetime.strptime(target_d, "%Y-%m-%d").date()
                            stmt = stmt.where(JournalTrade.trade_date == d_val)
                        except Exception:
                            pass
                    stmt = stmt.order_by(desc(JournalTrade.trade_date)).limit(10)
                    res = await db.execute(stmt)
                    trades = res.scalars().all()

                    if not trades:
                        return {"text": f"I couldn't find any logged trades matching your query."}

                    lines = []
                    for t in trades:
                        lines.append(f"- **ID:** {t.id} | {t.trade_date.isoformat()} | {t.direction} {t.quantity} {t.ticker} ({t.trade_type}) | PnL: **${t.pnl:.2f}** ({t.pnl_percent}%) | Grade: **{t.quality}**")
                    
                    header = f"Here are the trades I found:\n\n"
                    return {"text": header + "\n".join(lines)}

            return {"text": response.text or "I am listening."}
        except Exception as e:
            logger.error(f"Error in process_chat: {e}", exc_info=True)
            return {"text": f"Failed to process chat: {str(e)}"}
