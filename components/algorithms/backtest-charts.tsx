"use client"

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { BacktestResult } from '../../backend/src/backtester/types';

// Load react-plotly.js dynamically to prevent Next.js SSR document-not-defined errors
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface BacktestChartsProps {
  result: BacktestResult;
}

export function BacktestCharts({ result }: BacktestChartsProps) {
  const [chartType, setChartType] = useState<'line' | 'candlestick'>('line');

  if (!result || !result.equityCurve || result.equityCurve.length === 0) return null;

  const dates = result.equityCurve.map(pt => pt.timestamp);
  const portfolioValues = result.equityCurve.map(pt => pt.portfolioValue);
  const tickerPrices = result.equityCurve.map(pt => pt.price);

  // Calculate percentage returns
  const initialValue = result.initialCapital;
  const portfolioReturns = portfolioValues.map(v => ((v - initialValue) / initialValue) * 100);

  const initialPrice = tickerPrices[0];
  const benchmarkReturns = tickerPrices.map(p => ((p - initialPrice) / initialPrice) * 100);

  // Calculate drawdown curve
  let peak = initialValue;
  const drawdownCurve = result.equityCurve.map(pt => {
    if (pt.portfolioValue > peak) peak = pt.portfolioValue;
    return -((peak - pt.portfolioValue) / peak) * 100;
  });

  const isPnlPositive = result.finalCapital >= result.initialCapital;
  const mainColor = isPnlPositive ? '#00C805' : '#FF3B60';

  // Build Price Traces (Candles or line + indicators + trade markers)
  const priceTraces: any[] = [];
  const hasOhlcv = result.ohlcv && result.ohlcv.timestamp && result.ohlcv.timestamp.length > 0;

  if (hasOhlcv && result.ohlcv) {
    if (chartType === 'candlestick') {
      // Candlestick Chart Trace
      priceTraces.push({
        x: result.ohlcv.timestamp,
        open: result.ohlcv.open,
        high: result.ohlcv.high,
        low: result.ohlcv.low,
        close: result.ohlcv.close,
        type: 'candlestick',
        name: `${result.ticker} Price`,
        increasing: { line: { color: '#00C805', width: 1.5 } },
        decreasing: { line: { color: '#FF3B60', width: 1.5 } },
        hovertemplate: `Open: $%{open:.2f}<br>High: $%{high:.2f}<br>Low: $%{low:.2f}<br>Close: $%{close:.2f}<extra></extra>`,
      });
    } else {
      // 1. Add Price Close Line
      priceTraces.push({
        x: result.ohlcv.timestamp,
        y: result.ohlcv.close,
        type: 'scatter',
        mode: 'lines',
        name: `${result.ticker} Close`,
        line: { color: '#64748B', width: 1.5 },
        hovertemplate: `${result.ticker}: $%{y:.2f}<extra></extra>`,
      });
    }

    // 2. Add Indicator Overlays (SMA, EMA, BB bands)
    if (result.indicatorSeries) {
      Object.entries(result.indicatorSeries).forEach(([key, values]) => {
        const isOverlay = key.startsWith('sma_') || key.startsWith('ema_') || key.startsWith('bb_');
        if (isOverlay) {
          let color = '#3B82F6'; // Blue for SMA
          if (key.startsWith('ema_')) color = '#8B5CF6'; // Purple for EMA
          else if (key.startsWith('bb_')) color = 'rgba(239, 68, 68, 0.35)'; // Reddish for Bollinger Bands
          
          priceTraces.push({
            x: result.ohlcv?.timestamp,
            y: values,
            type: 'scatter',
            mode: 'lines',
            name: key.toUpperCase(),
            line: { 
              color, 
              width: 1.2, 
              dash: key.includes('bb_') ? 'dash' : 'solid'
            },
            hovertemplate: `${key.toUpperCase()}: %{y:.2f}<extra></extra>`,
          });
        }
      });
    }

    // 3. Add Buy Markers (▲)
    if (result.tradeMarkers) {
      const buyMarkers = result.tradeMarkers.filter(m => m.type === 'buy');
      if (buyMarkers.length > 0) {
        priceTraces.push({
          x: buyMarkers.map(m => m.timestamp),
          y: buyMarkers.map(m => m.price),
          type: 'scatter',
          mode: 'markers',
          name: 'Buy Entry',
          marker: {
            symbol: 'triangle-up',
            color: '#10B981', // Terminal Green
            size: 10,
          },
          text: buyMarkers.map(m => m.text),
          hovertemplate: '%{text}<extra></extra>',
        });
      }

      // 4. Add Sell Markers (▼)
      const sellMarkers = result.tradeMarkers.filter(m => m.type === 'sell');
      if (sellMarkers.length > 0) {
        priceTraces.push({
          x: sellMarkers.map(m => m.timestamp),
          y: sellMarkers.map(m => m.price),
          type: 'scatter',
          mode: 'markers',
          name: 'Sell Exit',
          marker: {
            symbol: 'triangle-down',
            color: '#EF4444', // Terminal Red
            size: 10,
          },
          text: sellMarkers.map(m => m.text),
          hovertemplate: '%{text}<extra></extra>',
        });
      }
    }
  }

  return (
    <div className="space-y-4">
      {/* ─── PRICE & TRADE MARKERS OVERLAYS (NEW) ─── */}
      {hasOhlcv && (
        <div className="bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg p-4 flex flex-col gap-2 font-mono">
          <div className="flex items-center justify-between border-b border-[#131316] pb-2">
            <span className="text-xs font-bold text-[#F5F5F7] uppercase tracking-wider">Simulation Price & Trade History</span>
            <div className="flex items-center gap-3">
              {/* Line vs Candle Switch Toggle */}
              <div className="flex bg-[#111] border border-[#222] rounded p-0.5">
                <button
                  type="button"
                  onClick={() => setChartType('line')}
                  className={`px-2 py-0.5 text-[9px] font-bold rounded uppercase transition-all ${
                    chartType === 'line' ? 'bg-terminal-green text-black' : 'text-[#888] hover:text-[#FFF]'
                  }`}
                >
                  Line
                </button>
                <button
                  type="button"
                  onClick={() => setChartType('candlestick')}
                  className={`px-2 py-0.5 text-[9px] font-bold rounded uppercase transition-all ${
                    chartType === 'candlestick' ? 'bg-terminal-green text-black' : 'text-[#888] hover:text-[#FFF]'
                  }`}
                >
                  Candles
                </button>
              </div>

              <div className="hidden sm:flex items-center gap-3 text-[10px] text-[#555]">
                <span className="flex items-center gap-1"><span className="w-2.5 h-1 bg-[#64748B] inline-block" /> Price</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-1 bg-[#10B981] inline-block" /> Buy</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-1 bg-[#EF4444] inline-block" /> Sell</span>
              </div>
            </div>
          </div>

          <div className="w-full h-[260px] overflow-hidden">
            <Plot
              data={priceTraces}
              layout={{
                autosize: true,
                height: 250,
                margin: { l: 45, r: 20, t: 15, b: 35 },
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                showlegend: false,
                xaxis: {
                  gridcolor: '#15151A',
                  zeroline: false,
                  tickfont: { size: 9, color: '#555', family: 'monospace' },
                  type: 'date',
                  rangeslider: { visible: false } // Disable default plotly rangeslider to save vertical space
                },
                yaxis: {
                  gridcolor: '#15151A',
                  zeroline: false,
                  tickfont: { size: 9, color: '#555', family: 'monospace' },
                  tickprefix: '$'
                },
                hovermode: 'x unified',
                hoverlabel: {
                  bgcolor: '#08080A',
                  bordercolor: '#1A1A1E',
                  font: { color: '#E5E5E5', size: 10, family: 'monospace' }
                }
              }}
              config={{ 
                responsive: true, 
                scrollZoom: true, // Allow zoom on scroll / trackpad pinch
                displayModeBar: true, // Display Plotly toolbar for scaling/pan axes
                displaylogo: false
              }}
              style={{ width: '100%', height: '100%' }}
            />
          </div>
        </div>
      )}

      {/* ─── CHART 1: EQUITY CURVE VS BENCHMARK ─── */}
      <div className="bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg p-4 flex flex-col gap-2 font-mono">
        <div className="flex items-center justify-between border-b border-[#131316] pb-2">
          <span className="text-xs font-bold text-[#F5F5F7] uppercase tracking-wider">Equity Curve Performance</span>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1"><span className="w-2.5 h-1 bg-[#00C805] inline-block" /> Portfolio</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-1 bg-[#444] inline-block" /> Buy & Hold</span>
          </div>
        </div>

        <div className="w-full h-[320px] overflow-hidden">
          <Plot
            data={[
              {
                x: dates,
                y: portfolioReturns,
                type: 'scatter',
                mode: 'lines',
                name: 'Portfolio',
                line: { color: mainColor, width: 2 },
                fill: 'tozeroy',
                fillcolor: isPnlPositive ? 'rgba(0, 200, 5, 0.03)' : 'rgba(255, 59, 96, 0.03)',
                hovertemplate: '%{x}<br>Portfolio: %{y:.2f}%<extra></extra>',
              },
              {
                x: dates,
                y: benchmarkReturns,
                type: 'scatter',
                mode: 'lines',
                name: 'Buy & Hold',
                line: { color: '#444444', width: 1.5, dash: 'dash' },
                hovertemplate: 'Buy & Hold: %{y:.2f}%<extra></extra>',
              }
            ]}
            layout={{
              autosize: true,
              height: 310,
              margin: { l: 40, r: 20, t: 15, b: 35 },
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor: 'rgba(0,0,0,0)',
              showlegend: false,
              xaxis: {
                gridcolor: '#15151A',
                zeroline: false,
                tickfont: { size: 9, color: '#555', family: 'monospace' },
                type: 'date'
              },
              yaxis: {
                gridcolor: '#15151A',
                zeroline: false,
                tickfont: { size: 9, color: '#555', family: 'monospace' },
                ticksuffix: '%'
              },
              hovermode: 'x unified',
              hoverlabel: {
                bgcolor: '#08080A',
                bordercolor: '#1A1A1E',
                font: { color: '#E5E5E5', size: 10, family: 'monospace' }
              }
            }}
            config={{ 
              responsive: true, 
              scrollZoom: true, 
              displayModeBar: true, 
              displaylogo: false 
            }}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </div>

      {/* ─── CHART 2: DRAWDOWN % ─── */}
      <div className="bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg p-4 flex flex-col gap-2 font-mono">
        <div className="flex items-center justify-between border-b border-[#131316] pb-2">
          <span className="text-xs font-bold text-[#F5F5F7] uppercase tracking-wider">Portfolio Drawdown</span>
        </div>

        <div className="w-full h-[160px] overflow-hidden">
          <Plot
            data={[
              {
                x: dates,
                y: drawdownCurve,
                type: 'scatter',
                mode: 'lines',
                name: 'Drawdown',
                line: { color: '#FF3B60', width: 1.2 },
                fill: 'tozeroy',
                fillcolor: 'rgba(255, 59, 96, 0.05)',
                hovertemplate: 'Drawdown: %{y:.2f}%<extra></extra>',
              }
            ]}
            layout={{
              autosize: true,
              height: 150,
              margin: { l: 40, r: 20, t: 10, b: 35 },
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor: 'rgba(0,0,0,0)',
              showlegend: false,
              xaxis: {
                gridcolor: '#15151A',
                zeroline: false,
                tickfont: { size: 9, color: '#555', family: 'monospace' },
                type: 'date'
              },
              yaxis: {
                gridcolor: '#15151A',
                zeroline: false,
                tickfont: { size: 9, color: '#555', family: 'monospace' },
                ticksuffix: '%'
              },
              hovermode: 'x unified',
              hoverlabel: {
                bgcolor: '#08080A',
                bordercolor: '#1A1A1E',
                font: { color: '#E5E5E5', size: 10, family: 'monospace' }
              }
            }}
            config={{ 
              responsive: true, 
              scrollZoom: true, 
              displayModeBar: true, 
              displaylogo: false 
            }}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </div>
    </div>
  );
}
