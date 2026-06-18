"use client"

import React from 'react';
import dynamic from 'next/dynamic';
import { BacktestResult } from '../../backend/src/backtester/types';

// Load react-plotly.js dynamically to prevent Next.js SSR document-not-defined errors
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface BacktestChartsProps {
  result: BacktestResult;
}

export function BacktestCharts({ result }: BacktestChartsProps) {
  if (result.equityCurve.length === 0) return null;

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

  return (
    <div className="space-y-4">
      {/* ─── CHART 1: EQUITY CURVE VS BENCHMARK ─── */}
      <div className="bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between border-b border-[#131316] pb-2">
          <span className="text-xs font-bold text-[#F5F5F7] uppercase tracking-wider">Equity Curve Performance</span>
          <div className="flex items-center gap-3 text-[10px] font-mono">
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
            config={{ responsive: true, displayModeBar: false }}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </div>

      {/* ─── CHART 2: DRAWDOWN % ─── */}
      <div className="bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg p-4 flex flex-col gap-2">
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
            config={{ responsive: true, displayModeBar: false }}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </div>
    </div>
  );
}
