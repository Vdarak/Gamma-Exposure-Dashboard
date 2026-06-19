import axios from 'axios';
import { createTrade, deleteTrade, getTrades } from './journalService';
import { getOptionsFlowData } from './optionsFlowService';
import { getCurrentData } from './dataRetrieval';
import { JournalTrade } from '../types';

/**
 * AI Analyst Service
 * Uses Google Gemini 1.5 Flash via REST API
 */
export class AIAnalystService {
  private getApiKey(): string {
    return process.env.GEMINI_API_KEY || '';
  }

  public isEnabled(): boolean {
    return this.getApiKey() !== '';
  }

  /**
   * Generates a structured market briefing focused on 0DTE GEX landscape.
   * PRIMARY data: Full GEX snapshot (Vanna, Charm, Gamma Flip, 0DTE levels).
   * SECONDARY data: Option flow aggregates (low-confidence context only).
   */
  public async generateBriefing(ticker: string, timeframe: 'Intraday' | 'Daily' | '5-Day' = 'Intraday'): Promise<string> {
    if (!this.isEnabled()) {
      return "AI Analyst is not configured. Please add GEMINI_API_KEY to your environment variables.";
    }

    try {
      console.log(`[AI Analyst] Gathering full GEX snapshot for ${ticker}...`);

      const currentSnap = await getCurrentData(ticker);
      if (!currentSnap || !currentSnap.options || currentSnap.options.length === 0) {
        return `No live option snapshot found for ${ticker}. Ensure the data ingestion pipeline is running.`;
      }

      const spot = currentSnap.spotPrice;
      const todayStr = new Date().toISOString().split('T')[0];

      // ─── Compute GEX, Vanna proxy, Charm proxy per contract ──────────
      interface StrikeStats {
        strike: number; expiration: string; dte: number;
        callGex: number; putGex: number; netGex: number;
        callOI: number; putOI: number;
        callVanna: number; putVanna: number;
        callCharm: number; putCharm: number;
        callIV: number; putIV: number;
        callVolume: number; putVolume: number;
      }

      const strikeMap = new Map<string, StrikeStats>();
      let totalGex = 0; let totalVanna = 0; let totalCharm = 0;
      const expiryTotals = new Map<string, { netGex: number; totalVanna: number; totalCharm: number; optionCount: number }>();

      for (const opt of currentSnap.options) {
        const expStr = (opt.expiration instanceof Date ? opt.expiration : new Date(String(opt.expiration))).toISOString().split('T')[0];
        const dte = Math.max(0, Math.round((new Date(expStr + 'T00:00:00Z').getTime() - new Date(todayStr + 'T00:00:00Z').getTime()) / 86400000));
        const strike = parseFloat(String(opt.strike));
        const gamma = parseFloat(String(opt.gamma || 0)) || 0;
        const oi = parseInt(String((opt as any).openInterest || (opt as any).open_interest || 0), 10) || 0;
        const delta = parseFloat(String(opt.delta || 0)) || 0;
        const theta = parseFloat(String(opt.theta || 0)) || 0;
        const vega = parseFloat(String(opt.vega || 0)) || 0;
        const iv = parseFloat(String((opt as any).impliedVolatility || 0)) || 0;
        const volume = parseInt(String(opt.volume || 0), 10) || 0;
        const sign = opt.type === 'C' ? 1 : -1;
        const gex = sign * spot * spot * gamma * oi / 1e9;
        const vanna = vega * delta;  // proxy: vol-delta sensitivity
        const charm = delta * theta; // proxy: time-decay on delta
        totalGex += gex; totalVanna += vanna; totalCharm += charm;

        const expT = expiryTotals.get(expStr) || { netGex: 0, totalVanna: 0, totalCharm: 0, optionCount: 0 };
        expT.netGex += gex; expT.totalVanna += vanna; expT.totalCharm += charm; expT.optionCount++;
        expiryTotals.set(expStr, expT);

        const key = `${strike}_${expStr}`;
        const cur: StrikeStats = strikeMap.get(key) || { strike, expiration: expStr, dte, callGex: 0, putGex: 0, netGex: 0, callOI: 0, putOI: 0, callVanna: 0, putVanna: 0, callCharm: 0, putCharm: 0, callIV: 0, putIV: 0, callVolume: 0, putVolume: 0 };
        if (opt.type === 'C') { cur.callGex += gex; cur.callOI += oi; cur.callVanna += vanna; cur.callCharm += charm; cur.callIV = iv; cur.callVolume += volume; }
        else { cur.putGex += gex; cur.putOI += oi; cur.putVanna += vanna; cur.putCharm += charm; cur.putIV = iv; cur.putVolume += volume; }
        cur.netGex = cur.callGex + cur.putGex;
        strikeMap.set(key, cur);
      }

      const allStrikes = Array.from(strikeMap.values());

      // 0DTE landscape
      const zdteStrikes = allStrikes.filter(s => s.dte === 0).sort((a, b) => Math.abs(b.netGex) - Math.abs(a.netGex));
      const zdteNetGex = zdteStrikes.reduce((s, x) => s + x.netGex, 0);
      const zdteVanna = zdteStrikes.reduce((s, x) => s + x.callVanna + x.putVanna, 0);
      const zdteCharm = zdteStrikes.reduce((s, x) => s + x.callCharm + x.putCharm, 0);
      const top0DTEStrikes = zdteStrikes.slice(0, 8).map(s => ({ strike: s.strike, netGex: s.netGex.toFixed(4) + 'B', callOI: s.callOI, putOI: s.putOI, callIV: (s.callIV * 100).toFixed(1) + '%', putIV: (s.putIV * 100).toFixed(1) + '%', type: s.netGex >= 0 ? 'CALL WALL (support)' : 'PUT WALL (resistance)' }));

      // Gamma flip level
      const nearSpot = allStrikes.filter(s => Math.abs(s.strike - spot) / spot < 0.05).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
      let gammaFlip: number | null = null;
      for (let i = 0; i < nearSpot.length - 1; i++) {
        const [a, b] = [nearSpot[i], nearSpot[i + 1]];
        if ((a.netGex >= 0 && b.netGex < 0) || (a.netGex < 0 && b.netGex >= 0)) {
          const t = Math.abs(a.netGex) / (Math.abs(a.netGex) + Math.abs(b.netGex));
          gammaFlip = a.strike + t * (b.strike - a.strike);
          break;
        }
      }

      // Top gamma strikes overall
      const topGammaStrikes = allStrikes.sort((a, b) => Math.abs(b.netGex) - Math.abs(a.netGex)).slice(0, 10).map(s => ({ strike: s.strike, expiry: s.expiration, dte: s.dte, netGex: s.netGex.toFixed(4) + 'B', callOI: s.callOI, putOI: s.putOI }));

      // Expiry breakdown
      const expiryBreakdown = Array.from(expiryTotals.entries()).map(([exp, t]) => {
        const dte = Math.max(0, Math.round((new Date(exp + 'T00:00:00Z').getTime() - new Date(todayStr + 'T00:00:00Z').getTime()) / 86400000));
        return { expiry: exp, dte, netGex: t.netGex.toFixed(4) + 'B', vannaNet: t.totalVanna.toFixed(4), charmNet: t.totalCharm.toFixed(4), contracts: t.optionCount };
      }).sort((a, b) => a.dte - b.dte).slice(0, 6);

      // Secondary: option flow (optional)
      let flowCtx: any = 'Unavailable';
      try {
        const f = await getOptionsFlowData(ticker, timeframe);
        flowCtx = { putCallRatio: f.aggregates.putCallRatio.toFixed(3), sentiment: f.aggregates.dominantSentiment, topFlowStrikes: f.topNotionalStrikes.slice(0, 3).map(s => ({ strike: s.strike, type: s.optionType, notional: '$' + (s.notionalChange / 1e3).toFixed(1) + 'K' })) };
      } catch (_) { /* optional */ }

      const context = {
        ticker, timeframe, spot: spot.toFixed(2),
        snapshotTime: currentSnap.timestamp,
        gammaFlip: gammaFlip ? gammaFlip.toFixed(2) : 'Not found near spot (±5%)',
        spotVsFlip: gammaFlip ? (spot > gammaFlip ? `ABOVE flip +${(spot - gammaFlip).toFixed(1)} pts → LONG GAMMA` : `BELOW flip -${(gammaFlip - spot).toFixed(1)} pts → SHORT GAMMA`) : 'Unknown',
        totalGexAllExpiries: totalGex.toFixed(4) + 'B',
        netVanna: totalVanna.toFixed(4),
        netCharm: totalCharm.toFixed(4),
        vannaSignal: totalVanna > 0 ? 'Positive — dealer delta expands on vol spike, upside self-amplifying' : 'Negative — dealer delta contracts on vol spike, downside self-amplifying',
        charmSignal: totalCharm > 0 ? 'Positive — delta bleeds long into EOD, gentle upward drift bias' : 'Negative — delta bleeds short into EOD, gentle downward drift bias',
        zdteLandscape: {
          netGex: zdteNetGex.toFixed(4) + 'B',
          vanna: zdteVanna.toFixed(4),
          charm: zdteCharm.toFixed(4),
          regime: zdteNetGex >= 0 ? 'LONG GAMMA — dealers sell rallies / buy dips, expect pinning / mean reversion / low vol' : 'SHORT GAMMA — dealers chase price, expect momentum / vol expansion / trending',
          top8Strikes: top0DTEStrikes
        },
        expiryBreakdown,
        topGammaStrikes,
        optionFlowContext: flowCtx
      };

      const systemPrompt = `You are an elite 0DTE and GEX (Gamma Exposure) terminal analyst. You receive a full GEX snapshot with computed Vanna and Charm proxies, a 0DTE gamma landscape, and a gamma flip level. Option flow data is a secondary, low-confidence signal — do NOT lead with it.

Generate your briefing using these EXACT markdown sections (## headers):

## 0DTE Gamma Regime
State the 0DTE regime (Long or Short Gamma based on zdteNetGex). Explain what this means for intraday dealer hedging behavior and expected price action character (pinning vs. trending).

## Gamma Flip & Key Levels  
State the gamma flip level vs. spot. List the top call-wall (positive GEX) and put-wall (negative GEX) 0DTE strikes from top8Strikes as key support/resistance/magnet levels. Use actual strike numbers from the data.

## Vanna & Charm Forces
Interpret the Vanna signal (vol-delta interaction) and Charm signal (time-decay delta drift). Will vol spikes amplify or dampen moves? Will the EOD delta bleed favor longs or shorts?

## Gamma Concentration by Expiry
Which expiry holds the heaviest gamma? Is it concentrated in 0DTE or spread across near-term expiries? Note any dominant gamma clusters.

## 0DTE Trade Ideas
2 specific, actionable setups using actual strikes from the data. For each: entry trigger, the gamma logic, and whether to fade (long gamma regime) or follow (short gamma regime) the move. Be concrete.

Rules: No generic intro. Start directly with "## 0DTE Gamma Regime". Cite actual strike prices and GEX values from context. Keep it crisp and terminal-grade.`;

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${this.getApiKey()}`;
      const response = await axios.post(
        geminiUrl,
        { contents: [{ parts: [{ text: `GEX snapshot for ${ticker} (${timeframe}):\n\n${JSON.stringify(context, null, 2)}` }] }], systemInstruction: { parts: [{ text: systemPrompt }] } },
        { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
      );

      const briefing = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      return briefing || "Failed to generate market briefing. Invalid response from Gemini API.";
    } catch (err: any) {
      console.error("[AI Analyst] Error generating briefing:", err.message);
      return `Failed to generate market briefing: ${err.message}`;
    }
  }

  /**
   * Process a general chat query, with full live GEX context injected.
   * The AI now has access to the actual current snapshot data for the given ticker.
   */
  public async processChat(
    message: string,
    history: Array<{ role: 'user' | 'model'; text: string }> = [],
    ticker: string = 'SPX',
    livePrice?: number
  ): Promise<{ text: string; tradeLogged?: JournalTrade }> {
    if (!this.isEnabled()) {
      return { text: "AI Analyst is not configured. Please add GEMINI_API_KEY to your environment variables." };
    }

    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${this.getApiKey()}`;

      // ─── Fetch live GEX snapshot for the active ticker ───────────────
      // This is what the AI needs to answer questions like "what are current gamma levels?"
      let gexDataBlock = `Active Ticker: ${ticker.toUpperCase()}\nNo GEX snapshot available — data may not have been collected yet.`;
      try {
        const snap = await getCurrentData(ticker.toUpperCase());
        if (snap && snap.options && snap.options.length > 0) {
          const spot = snap.spotPrice;
          const todayStr = new Date().toISOString().split('T')[0];
          let totalGex = 0; let totalVanna = 0; let totalCharm = 0;
          const expiryGex = new Map<string, number>();
          const localMap = new Map<number, { netGex: number; dte: number; callOI: number; putOI: number }>();

          for (const opt of snap.options) {
            const expStr = (opt.expiration instanceof Date ? opt.expiration : new Date(String(opt.expiration))).toISOString().split('T')[0];
            const dte = Math.max(0, Math.round((new Date(expStr + 'T00:00:00Z').getTime() - new Date(todayStr + 'T00:00:00Z').getTime()) / 86400000));
            const strike = parseFloat(String(opt.strike));
            const gamma = parseFloat(String(opt.gamma || 0)) || 0;
            const oi = parseInt(String((opt as any).openInterest || (opt as any).open_interest || 0), 10) || 0;
            const delta = parseFloat(String(opt.delta || 0)) || 0;
            const theta = parseFloat(String(opt.theta || 0)) || 0;
            const vega = parseFloat(String(opt.vega || 0)) || 0;
            const sign = opt.type === 'C' ? 1 : -1;
            const gex = sign * spot * spot * gamma * oi / 1e9;
            totalGex += gex;
            totalVanna += vega * delta;
            totalCharm += delta * theta;
            expiryGex.set(expStr, (expiryGex.get(expStr) || 0) + gex);
            const cur = localMap.get(strike) || { netGex: 0, dte, callOI: 0, putOI: 0 };
            cur.netGex += gex;
            if (opt.type === 'C') cur.callOI += oi; else cur.putOI += oi;
            localMap.set(strike, cur);
          }


          // 0DTE strikes
          const zdte = Array.from(localMap.entries()).filter(([, v]) => v.dte === 0).sort((a, b) => Math.abs(b[1].netGex) - Math.abs(a[1].netGex));
          const zdteTotal = zdte.reduce((s, [, v]) => s + v.netGex, 0);

          // Gamma flip
          const nearSpot = Array.from(localMap.entries()).filter(([k]) => Math.abs(k - spot) / spot < 0.05).sort((a, b) => Math.abs(a[0] - spot) - Math.abs(b[0] - spot));
          let flipLevel = 'Not detectable from current data';
          for (let i = 0; i < nearSpot.length - 1; i++) {
            const [ak, av] = nearSpot[i]; const [bk, bv] = nearSpot[i + 1];
            if ((av.netGex >= 0 && bv.netGex < 0) || (av.netGex < 0 && bv.netGex >= 0)) {
              const t = Math.abs(av.netGex) / (Math.abs(av.netGex) + Math.abs(bv.netGex));
              flipLevel = (ak + t * (bk - ak)).toFixed(2);
              break;
            }
          }

          // Top 10 strikes by abs GEX
          const topStrikes = Array.from(localMap.entries()).sort((a, b) => Math.abs(b[1].netGex) - Math.abs(a[1].netGex)).slice(0, 10).map(([strike, v]) => `  Strike ${strike}: ${v.netGex >= 0 ? '+' : ''}${v.netGex.toFixed(4)}B GEX (${v.dte}DTE, CallOI=${v.callOI}, PutOI=${v.putOI}, ${v.netGex >= 0 ? 'CALL-DOM' : 'PUT-DOM'})`).join('\n');

          // Top 0DTE strikes
          const top0DTE = zdte.slice(0, 5).map(([strike, v]) => `  Strike ${strike}: ${v.netGex >= 0 ? '+' : ''}${v.netGex.toFixed(4)}B (${v.netGex >= 0 ? 'CALL WALL' : 'PUT WALL'})`).join('\n');

          // Expiry breakdown
          const expiryBreakdown = Array.from(expiryGex.entries()).map(([exp, gex]) => {
            const dte = Math.max(0, Math.round((new Date(exp + 'T00:00:00Z').getTime() - new Date(todayStr + 'T00:00:00Z').getTime()) / 86400000));
            return { exp, dte, gex };
          }).sort((a, b) => a.dte - b.dte).slice(0, 6).map(e => `  ${e.exp} (${e.dte}DTE): ${e.gex >= 0 ? '+' : ''}${e.gex.toFixed(4)}B`).join('\n');

          gexDataBlock = `
=== LIVE GEX DATA — ${ticker.toUpperCase()} ===
Live Market Price: ${livePrice ? livePrice.toFixed(2) : spot.toFixed(2)}  ${livePrice && livePrice !== spot ? `(Data snapshot spot: ${spot.toFixed(2)})` : ''}
Snapshot Time  : ${snap.timestamp}
Total Net GEX  : ${totalGex >= 0 ? '+' : ''}${totalGex.toFixed(4)}B (${totalGex >= 0 ? 'LONG GAMMA' : 'SHORT GAMMA'})
Gamma Flip     : ${flipLevel}
Spot vs Flip   : ${flipLevel !== 'Not detectable from current data' ? ((livePrice || spot) > parseFloat(flipLevel) ? `ABOVE flip → Long Gamma regime` : `BELOW flip → Short Gamma regime`) : 'Unknown'}
Net Vanna      : ${totalVanna >= 0 ? '+' : ''}${totalVanna.toFixed(4)} (${totalVanna > 0 ? 'Positive — upside vol-delta amplification' : 'Negative — downside vol-delta amplification'})
Net Charm      : ${totalCharm >= 0 ? '+' : ''}${totalCharm.toFixed(4)} (${totalCharm > 0 ? 'Positive — bullish EOD delta drift' : 'Negative — bearish EOD delta drift'})

0DTE Net GEX   : ${zdteTotal >= 0 ? '+' : ''}${zdteTotal.toFixed(4)}B → ${zdteTotal >= 0 ? 'LONG GAMMA: expect pinning/mean-reversion' : 'SHORT GAMMA: expect trending/vol-expansion'}

TOP 0DTE STRIKES (by GEX):
${top0DTE || '  No 0DTE data available'}

TOP 10 STRIKES ALL EXPIRIES:
${topStrikes}

EXPIRY GEX BREAKDOWN:
${expiryBreakdown}
=== END GEX DATA ===`;
        }
      } catch (gexErr: any) {
        console.warn('[AI Chat] Could not fetch GEX snapshot:', gexErr.message);
      }

      // Map chat history to Gemini API format
      const contents = history.map(h => ({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.text }]
      }));
      contents.push({
        role: 'user',
        parts: [{ text: message }]
      });

      // Tool definitions for journal operations
      const tools = [
        {
          functionDeclarations: [
            {
              name: 'log_trade',
              description: 'Logs a single trade in the user\'s trading journal database.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  ticker: { type: 'STRING', description: 'The stock or option ticker symbol, e.g. SPY, TSLA, NIFTY' },
                  tradeType: { type: 'STRING', enum: ['Equity', 'Option'], description: 'Type of trade (Equity or Option)' },
                  strike: { type: 'NUMBER', description: 'Option strike price (leave null/empty for Equities)' },
                  optionType: { type: 'STRING', enum: ['C', 'P'], description: 'Option type: C for Call, P for Put (leave null/empty for Equities)' },
                  expiration: { type: 'STRING', description: 'Option expiration date in YYYY-MM-DD format (leave null/empty for Equities)' },
                  direction: { type: 'STRING', enum: ['Buy', 'Sell'], description: 'Trade direction (Buy or Sell)' },
                  quantity: { type: 'NUMBER', description: 'Quantity of shares or option contracts traded' },
                  entryPrice: { type: 'NUMBER', description: 'Average entry price per share or contract' },
                  exitPrice: { type: 'NUMBER', description: 'Average exit price per share or contract' },
                  pnl: { type: 'NUMBER', description: 'Total profit and loss (PnL) in dollars. Positive for profit, negative for loss.' },
                  pnlPercent: { type: 'NUMBER', description: 'Percentage return on the trade (e.g. 15.5 for 15.5%)' },
                  quality: { type: 'STRING', enum: ['S', 'A', 'B'], description: 'Grade of trade quality: S (excellent setups), A (good setups), B (suboptimal/average setups)' },
                  rationale: { type: 'STRING', description: 'Trader\'s note/rationale describing why they entered/exited the trade' },
                  strategy: { type: 'STRING', description: 'Name of the strategy used, e.g. GEX Breakout, Mean Reversion, Momentum' }
                },
                required: ['ticker', 'tradeType', 'direction', 'quantity', 'entryPrice', 'exitPrice', 'pnl', 'pnlPercent', 'quality']
              }
            },
            {
              name: 'log_batch_trades',
              description: 'Logs multiple trades at once (batch upload/import) into the trading journal database.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  trades: {
                    type: 'ARRAY',
                    description: 'The list of trades to log',
                    items: {
                      type: 'OBJECT',
                      properties: {
                        ticker: { type: 'STRING', description: 'The stock or option ticker symbol' },
                        tradeType: { type: 'STRING', enum: ['Equity', 'Option'] },
                        strike: { type: 'NUMBER' },
                        optionType: { type: 'STRING', enum: ['C', 'P'] },
                        expiration: { type: 'STRING', description: 'YYYY-MM-DD format' },
                        direction: { type: 'STRING', enum: ['Buy', 'Sell'] },
                        quantity: { type: 'NUMBER' },
                        entryPrice: { type: 'NUMBER' },
                        exitPrice: { type: 'NUMBER' },
                        pnl: { type: 'NUMBER' },
                        pnlPercent: { type: 'NUMBER' },
                        quality: { type: 'STRING', enum: ['S', 'A', 'B'] },
                        rationale: { type: 'STRING' },
                        strategy: { type: 'STRING' },
                        tradeDate: { type: 'STRING', description: 'Trade execution date YYYY-MM-DD' }
                      },
                      required: ['ticker', 'tradeType', 'direction', 'quantity', 'entryPrice', 'exitPrice', 'pnl', 'pnlPercent']
                    }
                  }
                },
                required: ['trades']
              }
            },
            {
              name: 'view_trades',
              description: 'Retrieves a list of logged trades from the trading journal database, optionally filtered by date.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  tradeDate: { type: 'STRING', description: 'The execution date of the trades to view (YYYY-MM-DD format). If not provided, retrieves today\'s trades, or recent ones if none found today.' }
                }
              }
            },
            {
              name: 'delete_trade',
              description: 'Deletes a trade from the trading journal database using its unique trade ID.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  id: { type: 'STRING', description: 'The unique trade ID (e.g. trade_1718742012423) to delete.' }
                },
                required: ['id']
              }
            }
          ]
        }
      ];

      const systemPrompt = `You are an elite GEX (Gamma Exposure) terminal analyst and trading assistant embedded in a professional options dashboard.

You have DIRECT ACCESS to the live GEX snapshot below. When users ask about gamma levels, strikes, the gamma flip, Vanna, Charm, or market regime — ANSWER DIRECTLY using the data provided. Do NOT say you cannot access real-time data. You have it right here.

${gexDataBlock}

You are also equipped with tools for the user's trading journal:
- 'log_trade': Logs a single trade.
- 'log_batch_trades': Logs multiple trades at once (batch upload/import).
- 'view_trades': Retrieves logged trades, optionally filtered by date.
- 'delete_trade': Deletes a trade by ID.

Journal tool rules:
- When user asks to view/list trades → call 'view_trades'
- When user asks to delete a trade with an ID → call 'delete_trade' directly
- When user asks to delete without specifying an ID → first call 'view_trades' to find the correct ID, then delete
- When user pastes a list/CSV/table of multiple trades → use 'log_batch_trades'
- PnL = (exitPrice - entryPrice) × quantity × (Option: ×100, Equity: ×1). For Sell/short trades, reverse signs.

If you call a tool, confirm what you did concisely. For GEX/market questions, use the live data above and give specific, analytical answers.`;



      // Call Gemini API
      const response = await axios.post(
        geminiUrl,
        {
          contents,
          systemInstruction: {
            parts: [{ text: systemPrompt }]
          },
          tools
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 20000
        }
      );

      const candidate = response.data?.candidates?.[0];
      const part = candidate?.content?.parts?.[0];

      // Check if Gemini wants to call a tool
      if (part?.functionCall) {
        const call = part.functionCall;

        if (call.name === 'log_trade') {
          const args = call.args;
          console.log('[AI Analyst] Gemini invoked log_trade with args:', args);

          // Construct trade data
          const todayStr = new Date().toISOString().split('T')[0];
          const timeStr = new Date().toTimeString().slice(0, 5); // "HH:MM"

          const trade: JournalTrade = {
            id: `trade_${Date.now()}`,
            tradeDate: args.tradeDate || todayStr,
            timeEntered: args.timeEntered || timeStr,
            timeExited: args.timeExited || timeStr,
            ticker: args.ticker.toUpperCase(),
            tradeType: args.tradeType as 'Equity' | 'Option',
            strike: args.strike || null,
            optionType: args.optionType || null,
            expiration: args.expiration || null,
            direction: args.direction as 'Buy' | 'Sell',
            quality: (args.quality || 'A') as 'S' | 'A' | 'B',
            pnl: parseFloat(args.pnl),
            pnlPercent: parseFloat(args.pnlPercent),
            rationale: args.rationale || 'Logged via AI Analyst chat',
            strategy: args.strategy || 'AI Logged',
            quantity: parseFloat(args.quantity),
            entryPrice: parseFloat(args.entryPrice),
            exitPrice: parseFloat(args.exitPrice),
            fees: args.fees || 0,
            status: 'Closed'
          };

          // Save trade to database
          const loggedTrade = await createTrade(trade);
          console.log('[AI Analyst] Trade successfully logged to database:', loggedTrade.id);

          // Return response back to user confirming log
          const details = `${trade.direction} ${trade.quantity} ${trade.ticker} ${trade.tradeType === 'Option' ? `${trade.strike} ${trade.optionType} exp ${trade.expiration}` : ''} at $${trade.entryPrice} (Exit: $${trade.exitPrice}, PnL: $${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)})`;

          return {
            text: `✅ I have logged that trade for you!\n\n**Details:** ${details}\n**Grade:** ${trade.quality}\n**Rationale:** ${trade.rationale}`,
            tradeLogged: loggedTrade
          };
        }

        if (call.name === 'log_batch_trades') {
          const args = call.args;
          const tradesList = args.trades || [];
          console.log(`[AI Analyst] Gemini invoked log_batch_trades with ${tradesList.length} trades`);

          const loggedTrades = [];
          const nowMs = Date.now();
          for (let i = 0; i < tradesList.length; i++) {
            const item = tradesList[i];
            const todayStr = new Date().toISOString().split('T')[0];
            const timeStr = new Date().toTimeString().slice(0, 5); // "HH:MM"

            const trade: JournalTrade = {
              id: `trade_${nowMs}_${i}`,
              tradeDate: item.tradeDate || todayStr,
              timeEntered: item.timeEntered || timeStr,
              timeExited: item.timeExited || timeStr,
              ticker: item.ticker.toUpperCase(),
              tradeType: item.tradeType as 'Equity' | 'Option',
              strike: item.strike || null,
              optionType: item.optionType || null,
              expiration: item.expiration || null,
              direction: item.direction as 'Buy' | 'Sell',
              quality: (item.quality || 'A') as 'S' | 'A' | 'B',
              pnl: parseFloat(item.pnl),
              pnlPercent: parseFloat(item.pnlPercent),
              rationale: item.rationale || 'Batch logged via AI Analyst chat',
              strategy: item.strategy || 'AI Batch Logged',
              quantity: parseFloat(item.quantity),
              entryPrice: parseFloat(item.entryPrice),
              exitPrice: parseFloat(item.exitPrice),
              fees: item.fees || 0,
              status: 'Closed'
            };
            const loggedTrade = await createTrade(trade);
            loggedTrades.push(loggedTrade);
          }

          return {
            text: `✅ I have successfully parsed and batch-logged **${loggedTrades.length}** trades into your trading journal!`,
            tradeLogged: loggedTrades[0]
          };
        }

        if (call.name === 'view_trades') {
          const args = call.args;
          const todayStr = new Date().toISOString().split('T')[0];
          const filterDate = args.tradeDate;

          const allTrades = await getTrades();

          let filtered = allTrades;
          let dateMsg = "recent trades";
          if (filterDate) {
            filtered = allTrades.filter(t => t.tradeDate === filterDate);
            dateMsg = `trades on ${filterDate}`;
          } else {
            const todayTrades = allTrades.filter(t => t.tradeDate === todayStr);
            if (todayTrades.length > 0) {
              filtered = todayTrades;
              dateMsg = `trades for today (${todayStr})`;
            } else {
              filtered = allTrades.slice(0, 10);
              dateMsg = "last 10 recent trades";
            }
          }

          if (filtered.length === 0) {
            return {
              text: `No trades found for **${filterDate || todayStr}**.`
            };
          }

          let listStr = `Here are your **${dateMsg}**:\n\n`;
          filtered.forEach(t => {
            const optDetails = t.tradeType === 'Option' ? ` ${t.strike} ${t.optionType} Exp ${t.expiration}` : '';
            listStr += `- **ID:** \`${t.id}\` | **${t.ticker}** (${t.tradeType}${optDetails}) | **${t.direction}** ${t.quantity} | Entry: $${t.entryPrice} | Exit: $${t.exitPrice} | PnL: **${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}**\n`;
          });

          return {
            text: listStr
          };
        }

        if (call.name === 'delete_trade') {
          const args = call.args;
          const tradeId = args.id;
          console.log('[AI Analyst] Gemini invoked delete_trade with id:', tradeId);

          const allTrades = await getTrades();
          const targetTrade = allTrades.find(t => t.id === tradeId);

          if (!targetTrade) {
            return {
              text: `⚠️ Could not find a trade with ID \`${tradeId}\` to delete.`
            };
          }

          const success = await deleteTrade(tradeId);
          if (success) {
            const optDetails = targetTrade.tradeType === 'Option' ? ` ${targetTrade.strike} ${targetTrade.optionType} Exp ${targetTrade.expiration}` : '';
            const details = `${targetTrade.direction} ${targetTrade.quantity} ${targetTrade.ticker} ${optDetails} (PnL: $${targetTrade.pnl.toFixed(2)})`;
            return {
              text: `✅ Successfully deleted trade \`${tradeId}\`!\n\n**Deleted Trade Details:** ${details}`,
              tradeLogged: { ...targetTrade, id: `delete_${tradeId}` }
            };
          } else {
            return {
              text: `⚠️ Failed to delete trade \`${tradeId}\`.`
            };
          }
        }
      }

      // If no function call, return regular text response
      return {
        text: part?.text || "I'm sorry, I couldn't process that query."
      };
    } catch (err: any) {
      console.error("[AI Analyst] Error processing chat query:", err.message);
      if (err.response && err.response.data) {
        console.error("[AI Analyst] API Error Details:", JSON.stringify(err.response.data, null, 2));
      }
      return { text: `⚠️ **Error:** ${err.message}` };
    }
  }

  /**
   * Parse a natural language strategy description into a structured strategy config
   */
  public async parseStrategy(description: string): Promise<{
    indicators: any[];
    entryRules: { indicators: any[] };
    exitRules: {
      stopLossPercent?: number;
      trailingStopPercent?: number;
      takeProfitPercent?: number;
      timeBasedExitDays?: number;
      indicators: any[];
    };
  }> {
    if (!this.isEnabled()) {
      throw new Error("AI Analyst is not configured. Please add GEMINI_API_KEY to your environment variables.");
    }

    const systemPrompt = `You are a professional algorithmic trading system developer. Your task is to convert a user's trading strategy described in natural language into a highly structured JSON configuration.

The output MUST be a JSON object with this exact typescript structure:
{
  "indicators": Array<{
    "type": "sma" | "ema" | "rsi" | "macd" | "bb" | "atr",
    "period1": number,
    "period2"?: number, // Required for macd (slow period, default 26)
    "signalPeriod"?: number, // Required for macd (signal period, default 9)
    "stdDev"?: number // Required for bb (std dev multiplier, default 2)
  }>,
  "entryRules": {
    "indicators": Array<{
      "indicator1": string, // E.g. "close", "sma_200", "rsi_14"
      "operator": "greater_than" | "less_than" | "crosses_above" | "crosses_below" | "equals",
      "indicator2": string | number // E.g. "sma_50", 30, 70
    }>
  },
  "exitRules": {
    "stopLossPercent": number | null, // percentage e.g. 2 for 2%
    "trailingStopPercent": number | null, // percentage e.g. 1.5 for 1.5%
    "takeProfitPercent": number | null, // percentage e.g. 5 for 5%
    "timeBasedExitDays": number | null, // integer number of days/bars
    "indicators": Array<{
      "indicator1": string,
      "operator": "greater_than" | "less_than" | "crosses_above" | "crosses_below" | "equals",
      "indicator2": string | number
    }>
  }
}

Indicator key generation rules:
Every indicator you use in 'entryRules' or 'exitRules' (other than raw 'close', 'open', 'high', 'low' or numerical constants) MUST be defined in the 'indicators' list.
The indicator names in 'indicator1' and 'indicator2' must use these exact patterns based on the indicator definitions:
- Simple Moving Average: "sma_P" where P is period1. E.g. "sma_20", "sma_200".
- Exponential Moving Average: "ema_P" where P is period1. E.g. "ema_9", "ema_50".
- Relative Strength Index: "rsi_P" where P is period1. E.g. "rsi_14".
- MACD:
  - Line: "macd_line_F_S_Sig" where F is fast, S is slow, Sig is signal period. E.g. "macd_line_12_26_9".
  - Signal: "macd_signal_F_S_Sig". E.g. "macd_signal_12_26_9".
  - Histogram: "macd_hist_F_S_Sig". E.g. "macd_hist_12_26_9".
- Bollinger Bands:
  - Upper: "bb_upper_P_M" where P is period1 and M is stdDev multiplier. E.g. "bb_upper_20_2".
  - Middle: "bb_middle_P_M". E.g. "bb_middle_20_2".
  - Lower: "bb_lower_P_M". E.g. "bb_lower_20_2".
- Average True Range: "atr_P" where P is period1. E.g. "atr_14".

Example input:
"Buy when RSI 14 crosses below 30 and close is above EMA 50. Exit when price crosses below SMA 20 or after 5 days. Set 2% stop loss and 5% take profit."

Example output:
{
  "indicators": [
    { "type": "rsi", "period1": 14 },
    { "type": "ema", "period1": 50 },
    { "type": "sma", "period1": 20 }
  ],
  "entryRules": {
    "indicators": [
      { "indicator1": "rsi_14", "operator": "crosses_below", "indicator2": 30 },
      { "indicator1": "close", "operator": "greater_than", "indicator2": "ema_50" }
    ]
  },
  "exitRules": {
    "stopLossPercent": 2,
    "trailingStopPercent": null,
    "takeProfitPercent": 5,
    "timeBasedExitDays": 5,
    "indicators": [
      { "indicator1": "close", "operator": "crosses_below", "indicator2": "sma_20" }
    ]
  }
}

Return ONLY raw JSON, with no markdown code fence blocks, starting with '{' and ending with '}'. Ensure all fields are filled, and if some risk parameters are not mentioned, return null for them.`;

    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${this.getApiKey()}`;
      const response = await axios.post(
        geminiUrl,
        {
          contents: [{ parts: [{ text: `Strategy description to parse:\n\n"${description}"` }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] }
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 35000 }
      );

      let text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error("Empty response received from Gemini.");
      }

      // Clean up markdown code blocks if the AI returned them
      text = text.trim();
      if (text.startsWith("```")) {
        text = text.replace(/^```(json)?/, "").replace(/```$/, "").trim();
      }

      const parsed = JSON.parse(text);
      
      // Basic schema verification and cleaning
      return {
        indicators: Array.isArray(parsed.indicators) ? parsed.indicators : [],
        entryRules: {
          indicators: Array.isArray(parsed.entryRules?.indicators) ? parsed.entryRules.indicators : []
        },
        exitRules: {
          stopLossPercent: typeof parsed.exitRules?.stopLossPercent === 'number' ? parsed.exitRules.stopLossPercent : undefined,
          trailingStopPercent: typeof parsed.exitRules?.trailingStopPercent === 'number' ? parsed.exitRules.trailingStopPercent : undefined,
          takeProfitPercent: typeof parsed.exitRules?.takeProfitPercent === 'number' ? parsed.exitRules.takeProfitPercent : undefined,
          timeBasedExitDays: typeof parsed.exitRules?.timeBasedExitDays === 'number' ? parsed.exitRules.timeBasedExitDays : undefined,
          indicators: Array.isArray(parsed.exitRules?.indicators) ? parsed.exitRules.indicators : []
        }
      };
    } catch (err: any) {
      console.error("[AI Analyst] Error parsing strategy:", err.message);
      throw new Error(`Failed to parse strategy description: ${err.message}`);
    }
  }
}
