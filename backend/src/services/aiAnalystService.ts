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
   * The AI now has access to the actual current snapshot.
   */
  public async processChat(
    message: string,
    history: Array<{ role: 'user' | 'model'; text: string }> = [],
    ticker: string = 'SPX',
    livePrice?: number,
    uiContext?: any,
    is0DteMode?: boolean,
    optionData?: any[]
  ): Promise<{ text: string; tradeLogged?: JournalTrade }> {
    if (!this.isEnabled()) {
      return { text: "AI Analyst is not configured. Please add GEMINI_API_KEY to your environment variables." };
    }

    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${this.getApiKey()}`;

      // ─── Fetch live options snapshot and compile GEX + IV metrics ────────
      let unifiedContextPayload: any = {
        ticker: ticker.toUpperCase(),
        spotPrice: livePrice || 0,
        timestamp: new Date().toISOString(),
        gexSummary: null,
        ivSummary: null,
        uiContext: uiContext || null,
        is0DteModeActive: !!is0DteMode
      };

      try {
        let snap: any = null;
        if (!optionData || optionData.length === 0) {
          snap = await getCurrentData(ticker.toUpperCase());
        }
        
        const optionsToProcess = (optionData && optionData.length > 0) ? optionData : (snap?.options || []);
        const spot = (optionData && optionData.length > 0) ? (livePrice || 0) : (snap?.spotPrice || 0);

        if (optionsToProcess.length > 0) {
          if (!livePrice) {
            unifiedContextPayload.spotPrice = spot;
          }
          const todayStr = new Date().toISOString().split('T')[0];
          let totalGex = 0; let totalVanna = 0; let totalCharm = 0;
          const expiryGex = new Map<string, number>();
          const localMap = new Map<number, { netGex: number; dte: number; callOI: number; putOI: number }>();

          for (const opt of optionsToProcess) {
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
          let flipLevel: number | null = null;
          for (let i = 0; i < nearSpot.length - 1; i++) {
            const [ak, av] = nearSpot[i]; const [bk, bv] = nearSpot[i + 1];
            if ((av.netGex >= 0 && bv.netGex < 0) || (av.netGex < 0 && bv.netGex >= 0)) {
              const t = Math.abs(av.netGex) / (Math.abs(av.netGex) + Math.abs(bv.netGex));
              flipLevel = ak + t * (bk - ak);
              break;
            }
          }

          // Top 10 strikes by abs GEX
          const topStrikesList = Array.from(localMap.entries())
            .sort((a, b) => Math.abs(b[1].netGex) - Math.abs(a[1].netGex))
            .slice(0, 10)
            .map(([strike, v]) => ({
              strike,
              netGexB: v.netGex,
              dte: v.dte,
              callOI: v.callOI,
              putOI: v.putOI,
              dominance: v.netGex >= 0 ? 'CALL-DOM' : 'PUT-DOM'
            }));

          // Top 5 0DTE strikes
          const top0DTEList = zdte.slice(0, 5).map(([strike, v]) => ({
            strike,
            netGexB: v.netGex,
            regime: v.netGex >= 0 ? 'CALL WALL' : 'PUT WALL'
          }));

          // Expiry breakdown
          const expBreakdown = Array.from(expiryGex.entries()).map(([exp, gex]) => {
            const dte = Math.max(0, Math.round((new Date(exp + 'T00:00:00Z').getTime() - new Date(todayStr + 'T00:00:00Z').getTime()) / 86400000));
            return { exp, dte, netGexB: gex };
          }).sort((a, b) => a.dte - b.dte).slice(0, 6);

          unifiedContextPayload.gexSummary = {
            totalNetGexB: totalGex,
            gammaRegime: totalGex >= 0 ? 'LONG GAMMA (volatility suppressing)' : 'SHORT GAMMA (volatility amplifying)',
            gammaFlip: flipLevel ? parseFloat(flipLevel.toFixed(2)) : null,
            netVanna: totalVanna,
            netCharm: totalCharm,
            zdteGexB: zdteTotal,
            zdteRegime: zdteTotal >= 0 ? 'LONG GAMMA (pinning/mean-reversion)' : 'SHORT GAMMA (momentum/volatility-expansion)',
            top0DTEStrikes: top0DTEList,
            top10StrikesAllExpiries: topStrikesList,
            expiryBreakdown: expBreakdown
          };

          // ─── IV SUMMARY METRICS ──────────────────────────────────────────
          const expiriesSorted = Array.from(expiryGex.keys()).sort();
          let atmIvFrontMonth = 0;
          let termStructureSlope = 'Flat';
          let skewRegime = 'Normal';
          let skewSteepness = 0;

          const uniqueStrikes = Array.from(localMap.keys()).sort((a, b) => a - b);
          const atmStrike = uniqueStrikes.reduce((closest, curr) => 
            Math.abs(curr - spot) < Math.abs(closest - spot) ? curr : closest, uniqueStrikes[0]
          );

          // Front expiry ATM IV
          const frontExpiry = expiriesSorted[0];
          const frontAtmOptions = optionsToProcess.filter((o: any) => 
            parseFloat(String(o.strike)) === atmStrike && 
            (o.expiration instanceof Date ? o.expiration : new Date(String(o.expiration))).toISOString().split('T')[0] === frontExpiry
          );
          if (frontAtmOptions.length > 0) {
            atmIvFrontMonth = (frontAtmOptions.reduce((sum: number, o: any) => sum + (o.impliedVolatility || 0), 0) / frontAtmOptions.length) * 100;
          }

          // Expiry term structure slope (compare near-term vs. far-term ATM IV)
          if (expiriesSorted.length > 1) {
            const farExpiry = expiriesSorted[expiriesSorted.length - 1];
            const farAtmOptions = optionsToProcess.filter((o: any) => 
              parseFloat(String(o.strike)) === atmStrike && 
              (o.expiration instanceof Date ? o.expiration : new Date(String(o.expiration))).toISOString().split('T')[0] === farExpiry
            );
            if (farAtmOptions.length > 0) {
              const farAtmIv = (farAtmOptions.reduce((sum: number, o: any) => sum + (o.impliedVolatility || 0), 0) / farAtmOptions.length) * 100;
              termStructureSlope = farAtmIv > atmIvFrontMonth ? 'Contango' : 'Backwardation';
            }
          }

          // Volatility Skew at 30 days or front expiry
          const targetExpiry = expiriesSorted.find(exp => {
            const dte = Math.max(0, Math.round((new Date(exp + 'T00:00:00Z').getTime() - new Date(todayStr + 'T00:00:00Z').getTime()) / 86400000));
            return dte >= 20 && dte <= 45;
          }) || expiriesSorted[Math.min(expiriesSorted.length - 1, 2)] || frontExpiry;

          if (targetExpiry) {
            const putStrike = atmStrike * 0.90;
            const callStrike = atmStrike * 1.10;

            const closestPutStrike = uniqueStrikes.reduce((closest, curr) => 
              Math.abs(curr - putStrike) < Math.abs(closest - putStrike) ? curr : closest, uniqueStrikes[0]
            );
            const closestCallStrike = uniqueStrikes.reduce((closest, curr) => 
              Math.abs(curr - callStrike) < Math.abs(closest - callStrike) ? curr : closest, uniqueStrikes[0]
            );

            const putOpts = optionsToProcess.filter((o: any) => 
              parseFloat(String(o.strike)) === closestPutStrike && 
              o.type === 'P' && 
              (o.expiration instanceof Date ? o.expiration : new Date(String(o.expiration))).toISOString().split('T')[0] === targetExpiry
            );
            const callOpts = optionsToProcess.filter((o: any) => 
              parseFloat(String(o.strike)) === closestCallStrike && 
              o.type === 'C' && 
              (o.expiration instanceof Date ? o.expiration : new Date(String(o.expiration))).toISOString().split('T')[0] === targetExpiry
            );

            if (putOpts.length > 0 && callOpts.length > 0) {
              const putIvVal = (putOpts[0].impliedVolatility || 0) * 100;
              const callIvVal = (callOpts[0].impliedVolatility || 0) * 100;
              skewSteepness = putIvVal - callIvVal;
              skewRegime = skewSteepness > 5 ? 'Asymmetric Put Bid (Crash Smirk)' : (skewSteepness < -3 ? 'Call Bid (Reverse Skew)' : 'Symmetric Smile');
            }
          }

          unifiedContextPayload.ivSummary = {
            overallAtmVolPct: atmIvFrontMonth,
            termStructure: {
              slope: termStructureSlope,
              frontMonthATM: atmIvFrontMonth,
              expiryChecked: targetExpiry
            },
            skewMetrics: {
              skewRegime,
              skewSteepnessPct: skewSteepness
            }
          };
        }
      } catch (gexErr: any) {
        console.warn('[AI Chat] Could not compile unified GEX/IV context:', gexErr.message);
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

      // Build system prompt incorporating the unified JSON context
      const systemPrompt = `You are an elite options market analyst and GEX/IV trading assistant.
You have DIRECT ACCESS to the live application-state and market context JSON payload provided below. When users ask questions, analyze this JSON and answer directly. Never state that you cannot access real-time data.

=== LIVE DASHBOARD JSON CONTEXT ===
${JSON.stringify(unifiedContextPayload, null, 2)}
=== END JSON CONTEXT ===

[RECONCILING CONTEXT & USER FOCUS]
If the JSON payload contains "uiContext", the user has triggered a query from a specific dashboard component (e.g. GEX surface, IV surface, expected move, option chain, or watchlist). Focus your analysis primarily on that component and active ticker first.

[0DTE EDUCATIONAL TRADE SESSIONS]
If "is0DteModeActive" is true, the user is in 0DTE mode. You must append an "Educational 0DTE Option Setup" section to your response:
1. Identify the 0DTE gamma regime from "gexSummary.zdteRegime".
   - LONG GAMMA (Positive 0DTE GEX): Suggest a mean-reversion setup (e.g., Short Iron Condor or Butterfly Spread) to capitalize on price pinning and theta decay at the Call/Put walls.
   - SHORT GAMMA (Negative 0DTE GEX): Suggest a momentum breakout setup (e.g., OTM Debit Spread or Long Straddle) to follow the price breakout beyond the walls.
2. Select actual strike prices from the "gexSummary.top0DTEStrikes" or proximity to spotPrice.
3. Keep it purely educational, describing the mechanics, risks, and dealer hedging effects. Add this disclaimer: "FOR EDUCATIONAL PURPOSES ONLY. OPTION TRADING INVOLVES SUBSTANTIAL RISK."

You are also equipped with tools for the user's trading journal:
- 'log_trade': Logs a single trade.
- 'log_batch_trades': Logs multiple trades at once.
- 'view_trades': Retrieves logged trades.
- 'delete_trade': Deletes a trade by ID.

Make your answers terminal-grade, concise, and mathematically rigorous.`;

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

          const todayStr = new Date().toISOString().split('T')[0];
          const timeStr = new Date().toTimeString().slice(0, 5);

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

          const loggedTrade = await createTrade(trade);
          console.log('[AI Analyst] Trade successfully logged to database:', loggedTrade.id);

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
            const timeStr = new Date().toTimeString().slice(0, 5);

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
    shouldExecute: boolean;
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
  },
  "shouldExecute": boolean // Set to true if the user explicitly requests to run, execute, simulate, test, or backtest the strategy. Set to false if they are only describing, configuring, asking, or tweaking parameters.
}

Indicator key generation rules:
Every indicator you use in 'entryRules' or 'exitRules' (other than raw 'close', 'open', 'high', 'low' or numerical constants) MUST be defined in the 'indicators' list.

CRITICAL STRUCTURAL ENFORCEMENT RULES (MANDATORY):
1. ALL INDICATOR NAMES AND KEYS MUST BE STRICTLY LOWERCASE.
   - For example: use "close", NOT "Close" or "Price".
   - Use "rsi_14", NOT "RSI_14" or "RSI".
   - Use "ema_50", NOT "EMA_50" or "EMA50".
   - Use "sma_200", NOT "SMA_200" or "sma200".
2. DO NOT USE THE WORD "price" IN RULES. If a user describes "price", "market price", or "last price", translate it to the lowercase indicator "close".
3. THE OPERATOR FIELD MUST BE STRICTLY ONE OF THESE LOWERCASE STRINGS: "greater_than", "less_than", "equals", "crosses_above", "crosses_below".
   - DO NOT USE mathematical symbols like ">", "<", "==", ">=", or "<=".
   - DO NOT USE capitalized or camelCase operators like "greaterThan", "GREATER_THAN", or "crossesAbove".

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
      
      // Clean and normalize indicators list
      const rawIndicators = Array.isArray(parsed.indicators) ? parsed.indicators : [];
      const cleanIndicators = rawIndicators.map((ind: any) => {
        if (!ind || typeof ind !== 'object') return ind;
        return {
          ...ind,
          type: typeof ind.type === 'string' ? ind.type.toLowerCase().trim() : ind.type,
          period1: typeof ind.period1 === 'number' ? ind.period1 : Number(ind.period1) || 14
        };
      });

      // Normalize rule condition
      const cleanRule = (rule: any) => {
        if (!rule || typeof rule !== 'object') return rule;
        
        let indicator1 = typeof rule.indicator1 === 'string' ? rule.indicator1.toLowerCase().trim() : String(rule.indicator1 || '');
        if (indicator1 === 'price') indicator1 = 'close';
        
        let indicator2 = rule.indicator2;
        if (typeof indicator2 === 'string') {
          indicator2 = indicator2.toLowerCase().trim();
          if (indicator2 === 'price') indicator2 = 'close';
          const num = Number(indicator2);
          if (!isNaN(num)) {
            indicator2 = num;
          }
        }
        
        let operator = typeof rule.operator === 'string' ? rule.operator.toLowerCase().trim() : '';
        if (operator === '>' || operator === '>=' || operator === 'greaterthan' || operator === 'greater_than') operator = 'greater_than';
        if (operator === '<' || operator === '<=' || operator === 'lessthan' || operator === 'less_than') operator = 'less_than';
        if (operator === '=' || operator === '==' || operator === '===' || operator === 'equals') operator = 'equals';
        if (operator === 'crossesabove' || operator === 'crosses_above') operator = 'crosses_above';
        if (operator === 'crossesbelow' || operator === 'crosses_below') operator = 'crosses_below';

        return {
          indicator1,
          operator,
          indicator2
        };
      };

      const rawEntryRules = parsed.entryRules && Array.isArray(parsed.entryRules.indicators) ? parsed.entryRules.indicators : [];
      const cleanEntryRules = rawEntryRules.map(cleanRule);

      const rawExitRules = parsed.exitRules && Array.isArray(parsed.exitRules.indicators) ? parsed.exitRules.indicators : [];
      const cleanExitRules = rawExitRules.map(cleanRule);
      
      return {
        indicators: cleanIndicators,
        entryRules: {
          indicators: cleanEntryRules
        },
        exitRules: {
          stopLossPercent: typeof parsed.exitRules?.stopLossPercent === 'number' ? parsed.exitRules.stopLossPercent : undefined,
          trailingStopPercent: typeof parsed.exitRules?.trailingStopPercent === 'number' ? parsed.exitRules.trailingStopPercent : undefined,
          takeProfitPercent: typeof parsed.exitRules?.takeProfitPercent === 'number' ? parsed.exitRules.takeProfitPercent : undefined,
          timeBasedExitDays: typeof parsed.exitRules?.timeBasedExitDays === 'number' ? parsed.exitRules.timeBasedExitDays : undefined,
          indicators: cleanExitRules
        },
        shouldExecute: !!parsed.shouldExecute
      };
    } catch (err: any) {
      console.error("[AI Analyst] Error parsing strategy:", err.message);
      throw new Error(`Failed to parse strategy description: ${err.message}`);
    }
  }
}
