"use client"

import { useMemo, useState } from "react"
import { Bar } from "react-chartjs-2"
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  type ChartOptions,
} from "chart.js"

import type { OptionData } from "@/lib/types"
import { computeGEXByStrike, computeVolumeByStrike, findZeroGammaLevel, type PricingMethod } from "@/lib/calculations"
import { PricingMethodToggle } from "../pricing-method-toggle"

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

interface GEXByStrikeChartProps {
  data: OptionData[]
  ticker: string
  spotPrice: number
  selectedExpiry: string
  pricingMethod: PricingMethod
  onPricingMethodChange: (method: PricingMethod) => void
  market?: 'USA' | 'INDIA'
}

export function GEXByStrikeChart({ data, ticker, spotPrice, selectedExpiry, pricingMethod, onPricingMethodChange, market = 'USA' }: GEXByStrikeChartProps) {
  // Add state for y-axis min/max
  const [yMin, setYMin] = useState<number | undefined>(undefined);
  const [yMax, setYMax] = useState<number | undefined>(undefined);
  
  // Add state for GEX display mode and volume chart visibility
  const [showAbsoluteGEX, setShowAbsoluteGEX] = useState(false); // false = Net GEX, true = Absolute GEX
  const [showVolumeChart, setShowVolumeChart] = useState(true);

  // For Indian markets, force Black-Scholes as Indian options are European-style (no early exercise)
  const effectivePricingMethod = market === 'INDIA' ? 'black-scholes' : pricingMethod;

  // Filter data by expiry if needed
  const filteredData = selectedExpiry === "All Dates"
    ? data
    : data.filter(option => option.expiration.toISOString().split("T")[0] === selectedExpiry)

  // Get the specific expiry date for gamma flip calculation
  const specificExpiryDate = selectedExpiry === "All Dates" 
    ? undefined 
    : new Date(selectedExpiry + "T00:00:00.000Z")

  // Compute GEX by strike
  const gexByStrike = useMemo(() => computeGEXByStrike(spotPrice, filteredData, effectivePricingMethod), [spotPrice, filteredData, effectivePricingMethod])
  // Compute actual volume by strike using the new function
  const volumeByStrike = useMemo(() => computeVolumeByStrike(filteredData), [filteredData])
  // Calculate gamma flip level for the specific expiry (or all data if "All Dates")
  const zeroGammaLevel = useMemo(() => 
    findZeroGammaLevel(selectedExpiry === "All Dates" ? data : filteredData, spotPrice, specificExpiryDate), 
    [data, filteredData, spotPrice, selectedExpiry, specificExpiryDate]
  )

  // Prepare strikes, gamma, and volume arrays
  // Use all unique strikes from both GEX and volume data, sorted ascending
  const allStrikes = new Set([
    ...gexByStrike.map(item => item.strike),
    ...volumeByStrike.map(item => item.strike)
  ])
  const uniqueStrikes = Array.from(allStrikes).sort((a, b) => a - b);

  // Map gamma and volume to unique strikes, fill 0 if missing
  const gammaLevelsUniform = uniqueStrikes.map(strike => {
    const found = gexByStrike.find(item => item.strike === strike);
    return found ? found.gex : 0;
  });
  const volumeByStrikeUniform = uniqueStrikes.map(strike => {
    const found = volumeByStrike.find(item => item.strike === strike);
    return found ? found.volume : 0;
  });

  // Dynamically set max for axes
  const maxGamma = Math.max(...gammaLevelsUniform.map(Math.abs)) * 1.1 || 1;
  const maxVolume = Math.max(...volumeByStrikeUniform) * 1.1 || 1;

  // Find ATM strike (closest to spot price)
  const atmStrike = useMemo(() => {
    if (uniqueStrikes.length === 0) return spotPrice;
    return uniqueStrikes.reduce((prev, curr) => Math.abs(curr - spotPrice) < Math.abs(prev - spotPrice) ? curr : prev, uniqueStrikes[0]);
  }, [uniqueStrikes, spotPrice]);

  // Pills for y-axis zoom
  const zoomPercents = [1, 2, 3, 5, 10, 20, 30];
  const [activeZoom, setActiveZoom] = useState<number | null>(null);

  // Compute filtered strikes for zoom
  const filteredStrikes = useMemo(() => {
    if (!activeZoom) return uniqueStrikes;
    const range = atmStrike * (activeZoom / 100);
    return uniqueStrikes.filter(strike => strike >= atmStrike - range && strike <= atmStrike + range);
  }, [uniqueStrikes, atmStrike, activeZoom]);

  // Filter gamma and volume arrays to match filtered strikes
  const gammaLevelsFiltered = filteredStrikes.map(strike => {
    const found = gexByStrike.find(item => item.strike === strike);
    return found ? found.gex : 0;
  });

  // For Absolute GEX mode: Separate calls and puts GEX for butterfly visualization
  const callGEXFiltered = filteredStrikes.map(strike => {
    const callOptions = filteredData.filter(option => option.strike === strike && option.type === "C");
    if (callOptions.length === 0) return 0;
    
    let callGEX = 0;
    callOptions.forEach(option => {
      if (option.GEX_BS) {
        callGEX += Math.abs(option.GEX_BS); // Always positive for calls
      }
    });
    
    return callGEX / 1e9; // Positive direction (right side)
  });

  const putGEXFiltered = filteredStrikes.map(strike => {
    const putOptions = filteredData.filter(option => option.strike === strike && option.type === "P");
    if (putOptions.length === 0) return 0;
    
    let putGEX = 0;
    putOptions.forEach(option => {
      if (option.GEX_BS) {
        putGEX += Math.abs(option.GEX_BS); // Get absolute value
      }
    });
    
    return -putGEX / 1e9; // Negative direction (left side)
  });

  const volumeByStrikeFiltered = filteredStrikes.map(strike => {
    const found = volumeByStrike.find(item => item.strike === strike);
    return found ? found.volume : 0;
  });

  // Dynamically set max for axes (use filtered arrays)
  const maxNetGEX = Math.max(...gammaLevelsFiltered.map(Math.abs)) * 1.1 || 1;
  const maxCallGEX = Math.max(...callGEXFiltered.map(Math.abs)) * 1.1 || 1;
  const maxPutGEX = Math.max(...putGEXFiltered.map(Math.abs)) * 1.1 || 1;
  const maxAbsoluteGEX = Math.max(maxCallGEX, maxPutGEX);
  const maxGammaFiltered = showAbsoluteGEX ? maxAbsoluteGEX : maxNetGEX;
  const maxVolumeFiltered = Math.max(...volumeByStrikeFiltered) * 1.1 || 1;

  const handleZoom = (percent: number) => {
    setActiveZoom(percent);
    setYMin(undefined);
    setYMax(undefined);
  };
  const handleResetZoom = () => {
    setActiveZoom(null);
    setYMin(undefined);
    setYMax(undefined);
  };

  const baseOptions: ChartOptions<'bar'> = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: {
        top: 16,
        right: 24,
        bottom: 16,
        left: 24,
      },
    },
    plugins: {
      legend: { 
        display: true,
        position: 'top',
        labels: {
          color: "rgba(255, 255, 255, 0.8)",
          font: { size: 11 },
          usePointStyle: true,
          pointStyle: 'rect', // Rectangle style for bar charts
          filter: function(item) {
            // Show all legend items including reference lines
            return true;
          }
        }
      },
      tooltip: {
        enabled: true,
        backgroundColor: 'rgba(24, 28, 42, 0.9)',
        titleColor: 'rgb(255, 255, 255)',
        bodyColor: 'rgb(255, 255, 255)',
        borderColor: 'rgb(42, 52, 89)',
        borderWidth: 1,
        padding: 8,
        displayColors: true,
        titleFont: { size: 12 },
        bodyFont: { size: 11 },
        callbacks: {
          label: function(context) {
            const value = context.raw as number;
            
            if (showAbsoluteGEX) {
              // Absolute GEX mode
              if (context.datasetIndex === 0) {
                // Calls dataset
                return `Calls GEX: ${value.toFixed(3)}B`;
              } else if (context.datasetIndex === 1) {
                // Puts dataset
                return `Puts GEX: ${Math.abs(value).toFixed(3)}B`;
              } else {
                // Reference lines (spot price or gamma flip) - just show the label
                return context.dataset.label || '';
              }
            } else {
              // Net GEX mode
              if (context.datasetIndex === 0) {
                // Net Gamma dataset with conditional coloring
                const sign = value >= 0 ? '+' : '';
                const colorType = value >= 0 ? '(Positive)' : '(Negative)';
                return `Net GEX: ${sign}${value.toFixed(3)}B ${colorType}`;
              } else {
                // Reference lines (spot price or gamma flip) - just show the label
                return context.dataset.label || '';
              }
            }
          }
        }
      }
    },
    scales: {
      y: {
        grid: { color: "rgba(42, 52, 89, 0.6)" },
        ticks: { 
          color: "rgba(255, 255, 255, 0.8)",
          font: { size: 11 },
          maxTicksLimit: 12,
          padding: 8,
          autoSkip: true
        },
        title: { 
          display: true, 
          text: "Strike",
          color: "rgba(255, 255, 255, 0.8)",
          font: { size: 12 },
          padding: { top: 4, bottom: 4 }
        },
        min: yMin,
        max: yMax,
      }
    }
  }

  const gammaOptions: ChartOptions<'bar'> = {
    ...baseOptions,
    plugins: {
      ...baseOptions.plugins,
      title: { 
        display: true, 
        text: `${ticker} ${showAbsoluteGEX ? 'Absolute' : 'Net'} Gamma by Strike (${selectedExpiry === "All Dates" ? "All Expiries" : selectedExpiry})`, 
        color: "rgba(255, 255, 255, 0.9)",
        font: { size: 14, weight: "bold" },
        padding: { top: 10, bottom: 15 }
      },
    },
    scales: {
      ...baseOptions.scales,
      y: {
        ...baseOptions.scales?.y,
        reverse: true,
      },
      x: {
        grid: { color: "rgba(42, 52, 89, 0.6)" },
        ticks: { 
          color: "rgba(255, 255, 255, 0.8)",
          font: { size: 11 },
          maxTicksLimit: 8,
          padding: 5
        },
        title: { 
          display: true, 
          text: showAbsoluteGEX ? "Gamma (Calls → | ← Puts)" : "Net Gamma",
          color: "rgba(255, 255, 255, 0.8)",
          font: { size: 12 },
          padding: { top: 8, bottom: 4 }
        },
        min: -maxGammaFiltered,
        max: maxGammaFiltered,
      },
    },
  }

  const volumeOptions: ChartOptions<'bar'> = {
    ...baseOptions,
    plugins: {
      ...baseOptions.plugins,
      title: { 
        display: true, 
        text: `${ticker} Volume by Strike (${selectedExpiry === "All Dates" ? "All Expiries" : selectedExpiry})`,
        color: "rgba(255, 255, 255, 0.9)",
        font: { size: 14, weight: "bold" },
        padding: { top: 10, bottom: 15 }
      },
    },
    scales: {
      ...baseOptions.scales,
      y: {
        ...baseOptions.scales?.y,
        reverse: true,
      },
      x: {
        grid: { color: "rgba(42, 52, 89, 0.6)" },
        ticks: { 
          color: "rgba(255, 255, 255, 0.8)",
          font: { size: 11 },
          maxTicksLimit: 8,
          padding: 5
        },
        title: { 
          display: true, 
          text: "Volume (Contracts Traded)",
          color: "rgba(255, 255, 255, 0.8)",
          font: { size: 12 },
          padding: { top: 8, bottom: 4 }
        },
        min: 0,
        max: maxVolumeFiltered,
      },
    },
  }

  // Helper function to format expiry date for display
  function formatExpiryLabel(selectedExpiry: string): string {
    if (selectedExpiry === "All Dates") {
      return "≤2M"
    }
    
    const today = new Date()
    const expiryDate = new Date(selectedExpiry + "T00:00:00.000Z")
    const daysDiff = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    
    if (daysDiff === 0) {
      return "≤0DTE"
    } else if (daysDiff === 1) {
      return "≤1DTE" 
    } else if (daysDiff <= 7) {
      return `≤${daysDiff}DTE`
    } else {
      // Show actual date for longer expiries with <= indicator
      return `≤${selectedExpiry}`
    }
  }

  // Helper function to find closest strike to a target price
  const findClosestStrike = (targetPrice: number, strikes: number[]): number | null => {
    if (strikes.length === 0) return null;
    
    let closest = strikes[0];
    let minDiff = Math.abs(targetPrice - closest);
    
    for (const strike of strikes) {
      const diff = Math.abs(targetPrice - strike);
      if (diff < minDiff) {
        minDiff = diff;
        closest = strike;
      }
    }
    
    return closest;
  };

  const gammaData = {
    labels: filteredStrikes,
    datasets: showAbsoluteGEX ? [
      // ABSOLUTE GEX MODE: Butterfly visualization with calls and puts
      // Calls dataset (positive side - right)
      {
        label: "Calls (Absolute)",
        data: callGEXFiltered,
        backgroundColor: "rgba(34, 197, 94, 0.6)", // Green for calls
        borderColor: "rgba(34, 197, 94, 0.9)",
        borderWidth: 1,
        barThickness: 8,
        categoryPercentage: 0.8,
        barPercentage: 0.9,
        order: 1,
      },
      // Puts dataset (negative side - left)
      {
        label: "Puts (Absolute)",
        data: putGEXFiltered,
        backgroundColor: "rgba(59, 130, 246, 0.6)", // Blue for puts
        borderColor: "rgba(59, 130, 246, 0.9)",
        borderWidth: 1,
        barThickness: 8,
        categoryPercentage: 0.8,
        barPercentage: 0.9,
        order: 1,
      },
      // Add center line (zero line) for better reference
      {
        label: "Center",
        data: filteredStrikes.map(() => 0),
        backgroundColor: "rgba(255, 255, 255, 0.1)",
        borderColor: "rgba(255, 255, 255, 0.3)",
        borderWidth: 1,
        barThickness: 1,
        categoryPercentage: 0.1,
        barPercentage: 1.0,
        order: 4, // Draw behind everything
      },
      // Add spot price reference
      {
        label: `Spot: ${spotPrice.toFixed(2)}`,
        data: filteredStrikes.map(strike => {
          const closestStrike = findClosestStrike(spotPrice, filteredStrikes);
          return strike === closestStrike ? maxGammaFiltered * 0.95 : 0;
        }),
        backgroundColor: "rgba(251, 191, 36, 0.6)",
        borderColor: "rgba(251, 191, 36, 0.9)",
        borderWidth: 1,
        barThickness: 2,
        categoryPercentage: 0.95,
        barPercentage: 1.0,
        order: 3,
      },
      // Add gamma flip reference
      ...(zeroGammaLevel ? [{
        label: `Gamma Flip (${formatExpiryLabel(selectedExpiry)}): ${zeroGammaLevel.toFixed(2)}`,
        data: filteredStrikes.map(strike => {
          const closestStrike = findClosestStrike(zeroGammaLevel, filteredStrikes);
          return strike === closestStrike ? maxGammaFiltered * 0.95 : 0;
        }),
        backgroundColor: "rgba(226, 0, 0, 0.6)",
        borderColor: "rgba(226, 0, 0, 0.9)",
        borderWidth: 1,
        barThickness: 2,
        categoryPercentage: 0.95,
        barPercentage: 1.0,
        order: 3,
      }] : []),
    ] : [
      // NET GEX MODE: Traditional single bar chart with conditional coloring
      {
        label: "Net Gamma",
        data: gammaLevelsFiltered,
        backgroundColor: gammaLevelsFiltered.map(value => 
          value >= 0 ? "rgba(59, 130, 246, 0.6)" : "rgba(34, 197, 94, 0.6)" // Blue for positive, Green for negative
        ),
        borderColor: gammaLevelsFiltered.map(value => 
          value >= 0 ? "rgba(59, 130, 246, 0.9)" : "rgba(34, 197, 94, 0.9)" // Blue for positive, Green for negative
        ),
        borderWidth: 1,
        barThickness: 8,
        categoryPercentage: 0.8,
        barPercentage: 0.9,
        order: 1,
      },
      // Add spot price reference for net mode
      {
        label: `Spot: ${spotPrice.toFixed(2)}`,
        data: filteredStrikes.map(strike => {
          const closestStrike = findClosestStrike(spotPrice, filteredStrikes);
          return strike === closestStrike ? maxGammaFiltered * 0.95 : 0;
        }),
        backgroundColor: "rgba(251, 191, 36, 0.6)",
        borderColor: "rgba(251, 191, 36, 0.9)",
        borderWidth: 1,
        barThickness: 2,
        categoryPercentage: 0.95,
        barPercentage: 1.0,
        order: 3,
      },
      // Add gamma flip reference for net mode
      ...(zeroGammaLevel ? [{
        label: `Gamma Flip (${formatExpiryLabel(selectedExpiry)}): ${zeroGammaLevel.toFixed(2)}`,
        data: filteredStrikes.map(strike => {
          const closestStrike = findClosestStrike(zeroGammaLevel, filteredStrikes);
          return strike === closestStrike ? maxGammaFiltered * 0.95 : 0;
        }),
        backgroundColor: "rgba(226, 0, 0, 0.6)",
        borderColor: "rgba(226, 0, 0, 0.9)",
        borderWidth: 1,
        barThickness: 2,
        categoryPercentage: 0.95,
        barPercentage: 1.0,
        order: 3,
      }] : []),
    ],
  }

  const volumeData = {
    labels: filteredStrikes,
    datasets: [
      {
        label: "Trading Volume",
        data: volumeByStrikeFiltered,
        backgroundColor: "rgba(0, 255, 255, 0.5)",
        borderColor: "rgba(0, 255, 255, 0.8)",
        borderWidth: 1,
        barThickness: 8,
        categoryPercentage: 0.8,
        barPercentage: 0.9,
      },
    ],
  }

  return (
    <div className="flex flex-col gap-4 w-full h-full max-h-[800px] overflow-hidden bg-[#181C2A] rounded-lg p-3 md:p-4 lg:p-6">
      {/* Controls */}
      <div className="flex flex-row justify-between items-center gap-4">
        {/* Left side - Y-Axis zoom pills */}
        <div className="flex flex-wrap gap-2">
          {zoomPercents.map(percent => (
            <button
              key={percent}
              className={`px-3 py-1 rounded-full text-xs border transition-colors ${activeZoom === percent ? 'bg-[#3A4579] text-white border-[#6EE7B7]' : 'bg-[#232946] text-white border-[#2A3459] hover:bg-[#2A3459]'}`}
              onClick={() => handleZoom(percent)}
              type="button"
            >
              ±{percent}%
            </button>
          ))}
          <button
            className={`px-3 py-1 rounded-full text-xs border transition-colors ${activeZoom === null ? 'bg-[#3A4579] text-white border-[#6EE7B7]' : 'bg-[#232946] text-white border-[#2A3459] hover:bg-[#2A3459]'}`}
            onClick={handleResetZoom}
            type="button"
          >
            Reset
          </button>
        </div>
        
        {/* Right side - Pricing method, GEX toggle and Volume visibility */}
        <div className="flex items-center gap-3">
          {/* Pricing Method Toggle - Disabled for Indian markets as they use European-style options */}
          {market === 'USA' ? (
            <PricingMethodToggle 
              pricingMethod={pricingMethod}
              onPricingMethodChange={onPricingMethodChange}
            />
          ) : (
            <div 
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 text-gray-300 rounded-lg border border-gray-600"
              title="Indian options are European-style (no early exercise), so Black-Scholes pricing is optimal. Binomial trees are designed for American options with early exercise features."
            >
              <span className="text-xs">Black-Scholes</span>
              <span className="text-xs text-gray-400">(European Options)</span>
            </div>
          )}
          
          {/* GEX Mode Toggle */}
          <button
            className={`px-3 py-1 rounded-full text-xs border transition-colors ${showAbsoluteGEX ? 'bg-[#059669] text-white border-[#10B981]' : 'bg-[#7C3AED] text-white border-[#8B5CF6]'}`}
            onClick={() => setShowAbsoluteGEX(!showAbsoluteGEX)}
            type="button"
            title={showAbsoluteGEX ? "Switch to Net GEX" : "Switch to Absolute GEX"}
          >
            {showAbsoluteGEX ? "Abs GEX" : "Net GEX"}
          </button>
          
          {/* Volume Chart Visibility Toggle */}
          <button
            className={`p-1.5 rounded-full border transition-all duration-300 ${showVolumeChart ? 'bg-[#3A4579] text-white border-[#6EE7B7]' : 'bg-[#232946] text-gray-400 border-[#2A3459] hover:bg-[#2A3459]'}`}
            onClick={() => setShowVolumeChart(!showVolumeChart)}
            type="button"
            title={showVolumeChart ? "Hide Volume Chart" : "Show Volume Chart"}
          >
            <svg 
              width="16" 
              height="16" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
              className="transition-transform duration-300"
            >
              {showVolumeChart ? (
                // Eye open icon
                <>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </>
              ) : (
                // Eye closed icon
                <>
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </>
              )}
            </svg>
          </button>
        </div>
      </div>
      
      <div className={`grid gap-4 w-full flex-1 transition-all duration-500 ease-in-out ${showVolumeChart ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
        <div className="relative flex flex-col min-h-[300px] transition-all duration-500 ease-in-out">
          <div className="absolute inset-0">
            <Bar options={gammaOptions} data={gammaData} />
          </div>
        </div>
        {showVolumeChart && (
          <div className="relative flex flex-col min-h-[300px] transition-all duration-500 ease-in-out animate-in slide-in-from-right">
            <div className="absolute inset-0">
              <Bar options={volumeOptions} data={volumeData} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
