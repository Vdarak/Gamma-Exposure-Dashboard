"use client"

import { useState, useCallback, useMemo, useRef, useEffect } from "react"
import { Loader2, TrendingUp, BarChart3, Calendar, Layers3, Target, Activity } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { OptionData } from "@/lib/types"
import { dataService } from "@/lib/data-service"
import { computeTotalGEX } from "@/lib/calculations"
import { GEXByStrikeChart } from "./charts/gex-by-strike-chart"
import { GEXByExpirationChart } from "./charts/gex-by-expiration-chart"
import { GEXSurfaceChart } from "./charts/gex-surface-chart"
import { CallPutWallsChart } from "./charts/call-put-walls-chart"
import { ExpectedMoveChart } from "./charts/expected-move-chart"
import { OptionChain } from "./charts/option-chain"
import { GEXDataGraphDashboard } from "./charts/gex-data-graph-dashboard"
import { TotalGEXCard } from "./charts/total-gex-card"

// --- Gauge component ---
function Gauge({ value, min, max, label, color, valueDisplay }: { value: number, min: number, max: number, label: string, color: string, valueDisplay: string }) {
  // Clamp value to min/max
  const clamped = Math.max(min, Math.min(max, value));
  const percent = (clamped - min) / (max - min);
  const angle = percent * 180;
  const radius = 60;
  const cx = 75;
  const cy = 75;
  const startX = cx - radius;
  const startY = cy;
  const endX = cx + radius;
  const endY = cy;
  const largeArcFlag = 1;
  const sweepFlag = 1;
  // Arc end for value
  const theta = (angle - 180) * (Math.PI / 180);
  const x = cx + radius * Math.cos(theta);
  const y = cy + radius * Math.sin(theta);
  // Needle
  const needleLength = 54;
  const needleAngle = (angle - 180) * (Math.PI / 180);
  const needleX = cx + needleLength * Math.cos(needleAngle);
  const needleY = cy + needleLength * Math.sin(needleAngle);
  return (
    <div className="flex flex-col items-center justify-center w-full">
      <svg width="150" height="90" viewBox="0 0 150 90">
        {/* Background arc */}
        <path d={`M${startX},${startY} A${radius},${radius} 0 ${largeArcFlag},${sweepFlag} ${endX},${endY}`} fill="none" stroke="#2A3459" strokeWidth="14" />
        {/* Value arc */}
        <path d={`M${startX},${startY} A${radius},${radius} 0 ${angle > 180 ? 1 : 0},${sweepFlag} ${x},${y}`} fill="none" stroke={color} strokeWidth="14" />
        {/* Needle */}
        <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke={color} strokeWidth="4" strokeLinecap="round" />
        {/* Needle base circle */}
        <circle cx={cx} cy={cy} r="6" fill={color} />
      </svg>
      <div className="text-3xl font-bold mt-2" style={{ color }}>{valueDisplay}</div>
      <div className="text-xs text-white mt-1">{label}</div>
    </div>
  );
}

function calculateGEXIntensity(optionData: OptionData[], spotPrice: number | null) {
  // Sum all GEX, not just gamma, for correct notional GEX intensity
  if (!optionData || optionData.length === 0) return 0;
  // If GEX is not present, compute it as spot * gamma * open_interest * 100 * spot * 0.01 (see computeTotalGEX)
  let totalGEX = 0;
  for (const o of optionData) {
    if (typeof o.GEX === 'number') {
      totalGEX += o.GEX;
    } else if (typeof o.gamma === 'number' && typeof o.open_interest === 'number' && typeof o.strike === 'number') {
      // Use spotPrice if available, else strike
      const px = spotPrice || o.strike;
      totalGEX += px * o.gamma * o.open_interest * 100 * px * 0.01 * (o.type === 'P' ? -1 : 1);
    }
  }
  return totalGEX / 1e9;
}

function calculateGEXWeightedVolatility(optionData: OptionData[]) {
  // Weighted average of implied volatility, weighted by absolute GEX (not just gamma)
  if (!optionData || optionData.length === 0) return 0;
  let numerator = 0;
  let denominator = 0;
  for (const o of optionData) {
    const gexAbs = Math.abs(typeof o.GEX === 'number' ? o.GEX : 0);
    numerator += gexAbs * (o.iv || 0);
    denominator += gexAbs;
  }
  return denominator ? numerator / denominator : 0;
}

export function GammaExposureDashboard() {
  const [ticker, setTicker] = useState("SPX")
  const [customTickers, setCustomTickers] = useState<string[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [newTicker, setNewTicker] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [spotPrice, setSpotPrice] = useState<number | null>(null)
  const [optionData, setOptionData] = useState<OptionData[]>([])
  const [totalGEX, setTotalGEX] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedGEXExpiry, setSelectedGEXExpiry] = useState<string>("All Dates")
  const [selectedMoveExpiry, setSelectedMoveExpiry] = useState<string>("All Dates")
  const [selectedWallExpiry, setSelectedWallExpiry] = useState<string>("")
  const [selectedRampExpiry, setSelectedRampExpiry] = useState<string>("")
  const [strikesCount, setStrikesCount] = useState<number | "ALL">(12)
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Function to handle new ticker submission
  const handleNewTickerSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newTicker.trim()) {
      const formattedTicker = newTicker.trim().toUpperCase()
      if (!defaultTickers.includes(formattedTicker as any) && !customTickers.includes(formattedTicker)) {
        setCustomTickers(prev => [...prev, formattedTicker])
        handleTickerSelect(formattedTicker)
      }
      setNewTicker("")
      setIsEditing(false)
    } else if (e.key === 'Escape') {
      setIsEditing(false)
      setNewTicker("")
    }
  }

  // Function to remove ticker
  const handleRemoveTicker = (tickerToRemove: string) => {
    if (customTickers.includes(tickerToRemove)) {
      setCustomTickers(prev => prev.filter(t => t !== tickerToRemove))
    }
    if (ticker === tickerToRemove) {
      handleTickerSelect(defaultTickers[0])
    }
  }

  // Start editing when clicking the ghost pill
  const startEditing = () => {
    setIsEditing(true)
    // Focus the input after it's rendered
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  // Effect to handle outside clicks when editing
  useEffect(() => {
    if (!isEditing) return

    const handleClickOutside = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setIsEditing(false)
        setNewTicker("")
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isEditing])

  // Default tickers list
  const defaultTickers = [
    "SPX",
    "SPY",
    "AAPL",
    "TSLA",
    "NVDA",
    "GOOGL",
    "MSFT",
    "QQQ",
    "GLD",
    "SLV",
    "PLTR",
    "MSTR",
    "GME",
    "CRWV",
    "HIMS",
    "SOFI"
  ] as const

  // Function to add custom ticker
  const handleAddCustomTicker = () => {
    const newTicker = prompt("Enter new ticker symbol:")?.toUpperCase()
    if (newTicker?.trim() && 
        !defaultTickers.includes(newTicker as any) && 
        !customTickers.includes(newTicker)) {
      setCustomTickers(prev => [...prev, newTicker])
      setTicker(newTicker)
      handleFetchData()
    }
  }

  // Function to handle ticker selection
  const handleTickerSelect = async (selected: string) => {
    try {
      setIsLoading(true);
      setError(null);
      
      const { spotPrice: fetchedSpotPrice, optionData: fetchedOptionData } = await dataService.fetchOptionData(
        selected.toUpperCase()
      );

      // Update all states at once
      setTicker(selected);
      setSpotPrice(fetchedSpotPrice);
      setOptionData(fetchedOptionData);
      setTotalGEX(computeTotalGEX(fetchedSpotPrice, fetchedOptionData));
      setLastUpdated(new Date());

      // Update expiry selections
      const currentToday = new Date();
      currentToday.setHours(0, 0, 0, 0);
      const currentFutureExpiries = Array.from(
        new Set(
          fetchedOptionData
            .map((option) => {
              const expDate = new Date(option.expiration);
              expDate.setHours(0, 0, 0, 0);
              return expDate;
            })
            .filter((expDate) => expDate >= currentToday)
            .map((expDate) => expDate.toISOString().split("T")[0])
        )
      ).sort();

      if (currentFutureExpiries.length > 0) {
        setSelectedWallExpiry(currentFutureExpiries[0]);
        if (!currentFutureExpiries.includes(selectedRampExpiry)) {
          setSelectedRampExpiry(currentFutureExpiries[0]);
        }
        if (!currentFutureExpiries.includes(selectedGEXExpiry) && selectedGEXExpiry !== "All Dates") {
          setSelectedGEXExpiry("All Dates");
        }
        if (!currentFutureExpiries.includes(selectedMoveExpiry) && selectedMoveExpiry !== "All Dates") {
          setSelectedMoveExpiry("All Dates");
        }
      } else {
        setSelectedWallExpiry("");
        setSelectedRampExpiry("");
        setSelectedGEXExpiry("All Dates");
        setSelectedMoveExpiry("All Dates");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An error occurred while fetching data";
      if (errorMessage.includes("Failed to fetch")) {
        setError(`Unable to connect to data source. Please check your internet connection.`);
      } else if (errorMessage.includes("404") || errorMessage.includes("not found")) {
        setError(`Ticker "${selected}" not found. Please verify the ticker symbol is correct and supported by CBOE.`);
      } else if (errorMessage.includes("500")) {
        setError(`Server error occurred. Please try again in a few moments.`);
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  }

  const todayUTC = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()))

  const futureExpiries = Array.from(
    new Set(
      optionData
        .map((option) => option.expiration) // option.expiration is already a UTC Date object from fixOptionData
        .filter((expDate) => expDate.getTime() >= todayUTC.getTime())
        .map((expDate) => expDate.toISOString().split("T")[0]), // Format as YYYY-MM-DD string
    ),
  ).sort()

  const handleFetchData = useCallback(async () => {
    if (!ticker.trim()) return

    setIsLoading(true)
    setError(null)

    try {
      const { spotPrice: fetchedSpotPrice, optionData: fetchedOptionData } = await dataService.fetchOptionData(
        ticker.toUpperCase(),
      )

      setSpotPrice(fetchedSpotPrice)
      setOptionData(fetchedOptionData)

      const gex = computeTotalGEX(fetchedSpotPrice, fetchedOptionData)
      setTotalGEX(gex)
      setLastUpdated(new Date());

      // Update expiry selections based on new data
      const currentToday = new Date()
      currentToday.setHours(0, 0, 0, 0)
      const currentFutureExpiries = Array.from(
        new Set(
          fetchedOptionData
            .map((option) => {
              const expDate = new Date(option.expiration)
              expDate.setHours(0, 0, 0, 0)
              return expDate
            })
            .filter((expDate) => expDate >= currentToday)
            .map((expDate) => expDate.toISOString().split("T")[0]),
        ),
      ).sort()

      if (currentFutureExpiries.length > 0) {
        // Default for Wall Expiry: nearest future date
        setSelectedWallExpiry(currentFutureExpiries[0])

        // Default for Ramp Expiry: nearest future date if not already valid
        if (!currentFutureExpiries.includes(selectedRampExpiry)) {
          setSelectedRampExpiry(currentFutureExpiries[0])
        }
        if (!currentFutureExpiries.includes(selectedGEXExpiry) && selectedGEXExpiry !== "All Dates") {
          setSelectedGEXExpiry("All Dates")
        }
        if (!currentFutureExpiries.includes(selectedMoveExpiry) && selectedMoveExpiry !== "All Dates") {
          setSelectedMoveExpiry("All Dates")
        }
      } else {
        setSelectedWallExpiry("")
        setSelectedRampExpiry("")
        setSelectedGEXExpiry("All Dates")
        setSelectedMoveExpiry("All Dates")
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An error occurred while fetching data"

      if (errorMessage.includes("Failed to fetch")) {
        setError(`Unable to connect to data source. Please check your internet connection.`)
      } else if (errorMessage.includes("404") || errorMessage.includes("not found")) {
        setError(`Ticker "${ticker}" not found. Please verify the ticker symbol is correct and supported by CBOE.`)
      } else if (errorMessage.includes("500")) {
        setError(`Server error occurred. Please try again in a few moments.`)
      } else {
        setError(errorMessage)
      }
    } finally {
      setIsLoading(false)
    }
  }, [ticker, selectedRampExpiry, selectedGEXExpiry, selectedMoveExpiry])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleTickerSelect(ticker)
  }

  // Add this function after handleFetchData
  const handleRetry = () => {
    setError(null)
    handleTickerSelect(ticker)
  }

  const handleRefresh = useCallback(async () => {
    setError(null);
    try {
      await handleTickerSelect(ticker);
      console.log('Refreshing data for', ticker);
    setFeedback({ message: 'Refreshed', type: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Refresh failed';
      setFeedback({ message: msg, type: 'error' });
    } finally {
      setTimeout(() => setFeedback(null), 1000);
    }
  }, [handleTickerSelect, ticker]);

  const hasData = spotPrice !== null && optionData.length > 0

  // Helper to filter optionData by selected expiry
  function getFilteredOptionData() {
    if (selectedGEXExpiry === "All Dates") return optionData;
    return optionData.filter((o) => {
      const expDate = o.expiration instanceof Date ? o.expiration : new Date(o.expiration);
      return expDate.toISOString().split("T")[0] === selectedGEXExpiry;
    });
  }

  const filteredOptionData = useMemo(getFilteredOptionData, [optionData, selectedGEXExpiry]);

  const gexIntensity = useMemo(() => calculateGEXIntensity(filteredOptionData, spotPrice), [filteredOptionData, spotPrice]);
  const gexWeightedVol = useMemo(() => calculateGEXWeightedVolatility(filteredOptionData), [filteredOptionData]);

  // Dynamic gauge range for GEX Intensity
  const gexAbsMax = useMemo(() => {
    // Find the max absolute GEX intensity for the current filtered data
    const values = filteredOptionData.map(o => {
      if (typeof o.GEX === 'number') return o.GEX / 1e9;
      if (typeof o.gamma === 'number' && typeof o.open_interest === 'number' && typeof o.strike === 'number') {
        const px = spotPrice || o.strike;
        return px * o.gamma * o.open_interest * 100 * px * 0.01 * (o.type === 'P' ? -1 : 1) / 1e9;
      }
      return 0;
    });
    // Always include the current gexIntensity in the range
    values.push(gexIntensity);
    const maxAbs = Math.max(1, ...values.map(v => Math.abs(v)));
    return maxAbs;
  }, [filteredOptionData, spotPrice, gexIntensity]);

  // Pastel red for negative, green for positive (same as total gamma)
  const pastelRed = '#FF6B81'; // pastel red
  const pastelGreen = '#22c55e'; // same as total gamma/net gamma

  // Dynamic color for the arc and value
  const gexIntensityColor = gexIntensity < 0 ? pastelRed : pastelGreen;

  // Auto-load data for default ticker on mount
  useEffect(() => {
    handleTickerSelect("SPX");
  }, []); // Empty dependency array - only run on mount

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">Gamma Exposure Indicator</h1>
        <p className="text-muted-foreground text-lg">
          Track and visualize dealers' notional gamma exposure (GEX) from CBOE data
        </p>
      </div>
      {/* Ticker Input */}
      <Card>
        <CardHeader>
          <CardTitle>Enter Ticker Symbol</CardTitle>
          <CardDescription>
            Select a ticker or enter a custom symbol to fetch gamma exposure data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {/* Default tickers */}
              {defaultTickers.map((suggestion) => (
                <div
                  key={suggestion}
                  onClick={() => handleTickerSelect(suggestion)}
                  className={`group relative inline-flex items-center rounded-full text-sm font-medium cursor-pointer
                    transition-all duration-200 ease-in-out overflow-hidden
                    ${ticker === suggestion
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    }`}
                >
                  <div className="px-2.5 py-1 transition-all duration-200 ease-in-out group-hover:pr-6">
                    {suggestion}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveTicker(suggestion);
                    }}
                    className="absolute right-0 w-6 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100
                      transition-all duration-200 ease-in-out pr-2"
                    aria-label={`Remove ${suggestion} ticker`}
                  >
                    <span className="text-xs">×</span>
                  </button>
                </div>
              ))}

              {/* Custom tickers */}
              {customTickers.map((suggestion) => (
                <div
                  key={suggestion}
                  onClick={() => handleTickerSelect(suggestion)}
                  className={`group relative inline-flex items-center rounded-full text-sm font-medium cursor-pointer
                    transition-all duration-200 ease-in-out overflow-hidden
                    ${ticker === suggestion
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    }`}
                >
                  <div className="px-2.5 py-1 transition-all duration-200 ease-in-out group-hover:pr-6">
                    {suggestion}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveTicker(suggestion);
                    }}
                    className="absolute right-0 w-6 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100
                      transition-all duration-200 ease-in-out pr-2"
                    aria-label={`Remove ${suggestion} ticker`}
                  >
                    <span className="text-xs">×</span>
                  </button>
                </div>
              ))}

              {/* Add ticker button/input */}
              {isEditing ? (
                <div className="inline-flex items-center rounded-full text-sm font-medium
                  border border-primary bg-background overflow-hidden"
                >
                  <input
                    ref={inputRef}
                    type="text"
                    value={newTicker}
                    onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
                    onKeyDown={handleNewTickerSubmit}
                    className="w-16 bg-transparent border-none focus:outline-none uppercase px-2.5 py-1"
                    placeholder="TICKER"
                  />
                </div>
              ) : (
                <button
                  onClick={startEditing}
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium
                    border border-dashed border-secondary/50 hover:border-primary/50
                    text-muted-foreground hover:text-primary 
                    transition-all duration-200 ease-in-out hover:scale-105"
                >
                  + TICKER
                </button>
              )}
            </div>

            {/* Custom ticker input */}
            <form onSubmit={handleSubmit} className="flex w-full max-w-sm items-center space-x-2">
              <Input
                type="text"
                placeholder="Enter custom ticker..."
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                disabled={isLoading}
                className="uppercase"
              />
              <Button type="submit" disabled={isLoading || !ticker.trim()}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading
                  </>
                ) : (
                  "Fetch"
                )}
              </Button>
            </form>

            {error && (
              <Alert className="mt-4" variant="destructive">
                <AlertDescription className="flex items-center justify-between">
                  <span>{error}</span>
                  <Button variant="outline" size="sm" onClick={handleRetry} className="ml-4">
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>

      {hasData && (
        <>
          {/* Spot Price and GEX Gauges */}
          <div className="grid gap-4 grid-cols-1 md:grid-cols-5">
            <Card className="md:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Spot Price</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-bold text-white mb-1">${spotPrice!.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <p className="text-sm text-[#B0B8D1] mb-6">Current market price</p>
                <div className="flex flex-col gap-2 mt-2">
                  {/* Total Gamma */}
                  <div className="flex flex-row items-center gap-2">
                    <span className="text-base text-[#B0B8D1] font-medium min-w-[100px]">Total Gamma:</span>
                    <span
                      className={`text-2xl font-bold ${(() => {
                        if (!optionData.length) return 'text-white';
                        const totalGamma = optionData.reduce((sum, o) => sum + (typeof o.gamma === 'number' ? o.gamma * (o.open_interest || 0) * 100 : 0), 0);
                        return totalGamma > 0 ? 'text-green-500' : totalGamma < 0 ? 'text-red-500' : 'text-white';
                      })()}`}
                    >
                      {(() => {
                        if (!optionData.length) return '--';
                        const totalGamma = optionData.reduce((sum, o) => sum + (typeof o.gamma === 'number' ? o.gamma * (o.open_interest || 0) * 100 : 0), 0);
                        if (Math.abs(totalGamma) >= 1e9) return `${(totalGamma / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 })} B`;
                        if (Math.abs(totalGamma) >= 1e6) return `${(totalGamma / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} M`;
                        return `${totalGamma.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
                      })()}
                    </span>
                  </div>
                  {/* Net Gamma */}
                  <div className="flex flex-row items-center gap-2">
                    <span className="text-base text-[#B0B8D1] font-medium min-w-[100px]">Net Gamma:</span>
                    <span
                      className={`text-2xl font-bold ${(() => {
                        if (!optionData.length) return 'text-white';
                        const netGamma = optionData.reduce((sum, o) => sum + (typeof o.gamma === 'number' ? (o.type === 'C' ? 1 : -1) * o.gamma * (o.open_interest || 0) * 100 : 0), 0);
                        return netGamma > 0 ? 'text-green-500' : netGamma < 0 ? 'text-red-500' : 'text-white';
                      })()}`}
                    >
                      {(() => {
                        if (!optionData.length) return '--';
                        const netGamma = optionData.reduce((sum, o) => sum + (typeof o.gamma === 'number' ? (o.type === 'C' ? 1 : -1) * o.gamma * (o.open_interest || 0) * 100 : 0), 0);
                        if (Math.abs(netGamma) >= 1e9) return `${(netGamma / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 })} B`;
                        if (Math.abs(netGamma) >= 1e6) return `${(netGamma / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} M`;
                        return `${netGamma.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
                      })()}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="md:col-span-3">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">GEX Dashboard</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-row gap-8 items-center justify-center">
                  <Gauge
                    value={gexIntensity}
                    min={-gexAbsMax}
                    max={gexAbsMax}
                    label="GEX Intensity Gauge"
                    color={gexIntensityColor}
                    valueDisplay={`${gexIntensity.toFixed(2)}B`}
                  />
                  <Gauge
                    value={gexWeightedVol}
                    min={0}
                    max={100}
                    label="GEX Weighted Volatility Gauge"
                    color="#FF3333"
                    valueDisplay={gexWeightedVol.toFixed(1)}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
          <TotalGEXCard
            totalGEX={totalGEX ?? 0}
            ticker={ticker}
            lastUpdated={lastUpdated}
            onRefresh={handleRefresh}
            feedback={feedback}
          />
          {/* Charts */}
          <Tabs defaultValue="option-chain" className="space-y-4">
            <TabsList className="grid w-full grid-cols-7">
              <TabsTrigger value="option-chain" className="flex items-center gap-1">
                <Activity className="h-4 w-4" />
                Option Chain
              </TabsTrigger>
              <TabsTrigger value="gex-strike" className="flex items-center gap-1">
                <BarChart3 className="h-4 w-4" />
                GEX by Strike
              </TabsTrigger>
              <TabsTrigger value="gex-expiration" className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                GEX by Expiration
              </TabsTrigger>
              <TabsTrigger value="gex-surface" className="flex items-center gap-1">
                <Layers3 className="h-4 w-4" />
                GEX Surface
              </TabsTrigger>
              <TabsTrigger value="expected-move" className="flex items-center gap-1">
                <Target className="h-4 w-4" />
                Expected Move
              </TabsTrigger>
              <TabsTrigger value="call-put-walls" className="flex items-center gap-1">
                <BarChart3 className="h-4 w-4" />
                Call/Put Walls
              </TabsTrigger>
              <TabsTrigger value="gex-data-graph" className="flex items-center gap-1">
                <BarChart3 className="h-4 w-4" />
                GEX Data Graph
              </TabsTrigger>
            </TabsList>

            <TabsContent value="option-chain">
              <Card>
                <CardHeader className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Option Chain</CardTitle>
                      <CardDescription>
                        Complete option chain with Greeks calculations, bid/ask spreads, and volume data.
                      </CardDescription>
                    </div>
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-2">
                        <label htmlFor="strikes-count" className="text-sm font-medium whitespace-nowrap">
                          Strikes:
                        </label>
                        <Select value={strikesCount.toString()} onValueChange={(value) => setStrikesCount(value === "ALL" ? "ALL" : parseInt(value))}>
                          <SelectTrigger className="w-20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="6">6</SelectItem>
                            <SelectItem value="10">10</SelectItem>
                            <SelectItem value="12">12</SelectItem>
                            <SelectItem value="16">16</SelectItem>
                            <SelectItem value="ALL">ALL</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center space-x-2">
                        <label htmlFor="expiry-select" className="text-sm font-medium whitespace-nowrap">
                          Expiration:
                        </label>
                        <Select value={selectedRampExpiry} onValueChange={setSelectedRampExpiry}>
                          <SelectTrigger className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {futureExpiries.map((expiry) => (
                              <SelectItem key={expiry} value={expiry}>
                                {expiry}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="h-[600px] overflow-auto">
                  <OptionChain
                    data={optionData}
                    ticker={ticker}
                    spotPrice={spotPrice!}
                    selectedExpiry={selectedRampExpiry}
                    onExpiryChange={setSelectedRampExpiry}
                    availableExpiries={futureExpiries}
                    strikesCount={strikesCount}
                    onStrikesCountChange={setStrikesCount}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="gex-strike">
              <Card>
                <CardHeader className="space-y-4">
                  <div>
                    <CardTitle>GEX by Strike (Interactive)</CardTitle>
                    <CardDescription>
                      Gamma exposure distribution across different strike prices with spot price and gamma flip levels
                    </CardDescription>
                  </div>
                  <div className="flex items-center space-x-2">
                    <label htmlFor="gex-expiry" className="text-sm font-medium">
                      Expiration Date:
                    </label>
                    <Select value={selectedGEXExpiry} onValueChange={setSelectedGEXExpiry}>
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="All Dates">All Dates</SelectItem>
                        {futureExpiries.map((expiry) => (
                          <SelectItem key={expiry} value={expiry}>
                            {expiry}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="relative h-[120vh] min-h-[800px] max-h-[1200px] w-full">
                  <div className="absolute inset-0">
                    <GEXByStrikeChart
                      data={optionData}
                      ticker={ticker}
                      spotPrice={spotPrice!}
                      selectedExpiry={selectedGEXExpiry}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="gex-expiration">
              <Card>
                <CardHeader>
                  <CardTitle>GEX by Expiration (Interactive)</CardTitle>
                  <CardDescription>Shows gamma exposure distribution across different expiration dates</CardDescription>
                </CardHeader>
                <CardContent className="h-[500px]">
                  <GEXByExpirationChart data={optionData} ticker={ticker} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="gex-surface">
              <Card>
                <CardHeader>
                  <CardTitle>GEX Surface (3D, Interactive)</CardTitle>
                  <CardDescription>
                    3D visualization of gamma exposure across both strike prices and expiration dates
                  </CardDescription>
                </CardHeader>
                <CardContent className="h-[600px]">
                  <GEXSurfaceChart data={optionData} ticker={ticker} spotPrice={spotPrice!} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="expected-move">
              <Card>
                <CardHeader className="space-y-4">
                  <div>
                    <CardTitle>Expected Move (Interactive)</CardTitle>
                    <CardDescription>
                      Expected moves based on the 16 Delta Method across different expiries
                    </CardDescription>
                  </div>
                  <div className="flex items-center space-x-2">
                    <label htmlFor="move-expiry" className="text-sm font-medium">
                      Expiration Date:
                    </label>
                    <Select value={selectedMoveExpiry} onValueChange={setSelectedMoveExpiry}>
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="All Dates">All Dates</SelectItem>
                        {futureExpiries.map((expiry) => (
                          <SelectItem key={expiry} value={expiry}>
                            {expiry}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="h-[500px]">
                  <ExpectedMoveChart
                    data={optionData}
                    ticker={ticker}
                    spotPrice={spotPrice!}
                    selectedExpiry={selectedMoveExpiry}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="call-put-walls">
              <Card>
                <CardHeader className="space-y-4">
                  <div>
                    <CardTitle>Call/Put Walls (Interactive)</CardTitle>
                    <CardDescription>
                      Open interest by strike for selected expiry date, highlighting call and put walls
                    </CardDescription>
                  </div>
                  <div className="flex items-center space-x-2">
                    <label htmlFor="wall-expiry" className="text-sm font-medium">
                      Expiration Date:
                    </label>
                    <Select value={selectedWallExpiry} onValueChange={setSelectedWallExpiry}>
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {futureExpiries.map((expiry) => (
                          <SelectItem key={expiry} value={expiry}>
                            {expiry}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="h-[500px]">
                  {selectedWallExpiry && (
                    <CallPutWallsChart
                      data={optionData}
                      ticker={ticker}
                      selectedExpiry={new Date(selectedWallExpiry)}
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="gex-data-graph">
              <Card>
                <CardHeader>
                  <CardTitle>GEX Data Graph</CardTitle>
                  <CardDescription>
                    Plots Total Gamma (purple) and Net Gamma (green) by expiry date. Positive and negative values are shown on the y-axis.
                  </CardDescription>
                </CardHeader>
                <CardContent className="h-[500px]">
                  <GEXDataGraphDashboard data={optionData} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
