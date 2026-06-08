"use client"

import { useState, useCallback, useMemo, useEffect } from "react"
import type { OptionData } from "@/lib/types"
import { dataService, type Market } from "@/lib/data-service"
import { computeTotalGEX, findZeroGammaLevel, type PricingMethod } from "@/lib/calculations"

// Layout components
import { TerminalHeader } from "./layout/terminal-header"
import { StatBar } from "./layout/stat-bar"
import { TabNavigation } from "./layout/tab-navigation"

// Chart components
import { GEXByStrikeChart } from "./charts/gex-by-strike-chart"
import { GEXByExpirationChart } from "./charts/gex-by-expiration-chart"
import { GEXSurfaceChart } from "./charts/gex-surface-chart"
import { CallPutWallsChart } from "./charts/call-put-walls-chart"
import { ExpectedMoveChart } from "./charts/expected-move-chart"
import { OptionChain } from "./charts/option-chain"
import { GEXDataGraphDashboard } from "./charts/gex-data-graph-dashboard"
import { ChartWrapper } from "./charts/chart-wrapper"
import { PricingMethodToggle } from "./pricing-method-toggle"
import { EnhancedTimeMachine } from "./enhanced-time-machine"
import { ExpirySelector, type ExpiryMode } from "./controls/expiry-selector"

// UI components
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// ─── Tab config ──────────────────────────────────────────────────

const TABS = [
  { id: 'option-chain', label: 'Option Chain' },
  { id: 'gex-profile', label: 'GEX Profile' },
  { id: 'gex-surface', label: 'Surface' },
  { id: 'expected-move', label: 'Expected Move' },
  { id: 'time-machine', label: 'Time Machine' },
]

// ─── GEX Profile sub-tabs ────────────────────────────────────────

const GEX_SUBTABS = [
  { id: 'by-strike', label: 'By Strike' },
  { id: 'by-expiration', label: 'By Expiration' },
  { id: 'call-put-walls', label: 'Call/Put Walls' },
  { id: 'data-graph', label: 'Data Graph' },
]

// ─── Ticker lists ────────────────────────────────────────────────

const USA_TICKERS = [
  "SPX", "SPY", "AAPL", "TSLA", "NVDA", "GOOGL", "MSFT", "QQQ",
  "GLD", "SLV", "PLTR", "MSTR", "GME", "CRWV", "HIMS", "SOFI",
]

const INDIA_TICKERS = [
  "NIFTY", "BANKNIFTY", "RELIANCE", "TCS", "INFY", "HINDUNILVR",
  "HDFCBANK", "ICICIBANK", "KOTAKBANK", "SBIN", "ITC", "LT",
  "BHARTIARTL", "ASIANPAINT", "MARUTI", "WIPRO",
]

// ─── Main component ─────────────────────────────────────────────

export function GammaExposureDashboard() {
  // Core state
  const [ticker, setTicker] = useState("SPX")
  const [market, setMarket] = useState<Market>("USA")
  const [pricingMethod, setPricingMethod] = useState<PricingMethod>("black-scholes")
  const [customTickers, setCustomTickers] = useState<string[]>([])

  // Data state
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [spotPrice, setSpotPrice] = useState<number | null>(null)
  const [optionData, setOptionData] = useState<OptionData[]>([])
  const [totalGEX, setTotalGEX] = useState<number>(0)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // UI state
  const [activeTab, setActiveTab] = useState("option-chain")
  const [gexSubTab, setGexSubTab] = useState("by-strike")
  const [selectedMoveExpiry, setSelectedMoveExpiry] = useState<string>("All Dates")
  const [selectedWallExpiry, setSelectedWallExpiry] = useState<string>("")
  const [strikesCount, setStrikesCount] = useState<number | "ALL">(12)
  const [selectedRampExpiry, setSelectedRampExpiry] = useState<string>("")

  // ─── Expiry selector state (shared across GEX Profile & Surface) ──
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>('90d')
  const [customSelectedExpiries, setCustomSelectedExpiries] = useState<string[]>([])

  // ─── Derived data ────────────────────────────────────────────

  const defaultTickers = market === 'USA' ? USA_TICKERS : INDIA_TICKERS

  const todayUTC = new Date(Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate()
  ))

  const futureExpiries = useMemo(() => Array.from(
    new Set(
      optionData
        .map((opt) => opt.expiration)
        .filter((exp) => exp.getTime() >= todayUTC.getTime())
        .map((exp) => exp.toISOString().split("T")[0])
    )
  ).sort(), [optionData])

  // Compute active expiries based on mode
  const activeExpiries = useMemo(() => {
    if (expiryMode === '90d') {
      const now = new Date()
      now.setHours(0, 0, 0, 0)
      return futureExpiries.filter(exp => {
        const expDate = new Date(exp + "T00:00:00Z")
        const dte = Math.ceil((expDate.getTime() - now.getTime()) / 86400000)
        return dte <= 90
      })
    }
    if (expiryMode === '0dte') {
      const now = new Date()
      now.setHours(0, 0, 0, 0)
      const today = futureExpiries.find(exp => {
        const expDate = new Date(exp + "T00:00:00Z")
        return Math.ceil((expDate.getTime() - now.getTime()) / 86400000) === 0
      })
      if (today) return [today]
      return futureExpiries.length > 0 ? [futureExpiries[0]] : []
    }
    // Custom mode
    return customSelectedExpiries
  }, [expiryMode, futureExpiries, customSelectedExpiries])

  const gammaFlipLevel = useMemo(() => {
    if (!spotPrice || !optionData.length) return null
    return findZeroGammaLevel(optionData, spotPrice)
  }, [optionData, spotPrice])

  const hasData = spotPrice !== null && optionData.length > 0

  // ─── Data fetching ───────────────────────────────────────────

  const fetchData = useCallback(async (
    selectedTicker: string,
    targetMarket?: Market
  ) => {
    try {
      setIsLoading(true)
      setError(null)
      const mkт = targetMarket || market

      const { spotPrice: sp, optionData: od } = await dataService.fetchOptionData(
        selectedTicker.toUpperCase(),
        mkт,
        pricingMethod
      )

      setTicker(selectedTicker)
      setSpotPrice(sp)
      setOptionData(od)
      setTotalGEX(computeTotalGEX(sp, od, pricingMethod))
      setLastUpdated(new Date())

      // Update expiry defaults
      const curToday = new Date()
      curToday.setHours(0, 0, 0, 0)
      const expiries = Array.from(new Set(
        od.map((o) => {
          const d = new Date(o.expiration)
          d.setHours(0, 0, 0, 0)
          return d
        })
          .filter((d) => d >= curToday)
          .map((d) => d.toISOString().split("T")[0])
      )).sort()

      if (expiries.length > 0) {
        setSelectedWallExpiry(expiries[0])
        if (!expiries.includes(selectedRampExpiry)) setSelectedRampExpiry(expiries[0])
        if (!expiries.includes(selectedMoveExpiry) && selectedMoveExpiry !== "All Dates") setSelectedMoveExpiry("All Dates")
      } else {
        setSelectedWallExpiry("")
        setSelectedRampExpiry("")
        setSelectedMoveExpiry("All Dates")
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An error occurred"
      if (msg.includes("Failed to fetch")) setError("Unable to connect. Check your internet connection.")
      else if (msg.includes("404") || msg.includes("not found")) setError(`Ticker "${selectedTicker}" not found.`)
      else if (msg.includes("500")) setError("Server error. Try again shortly.")
      else setError(msg)
    } finally {
      setIsLoading(false)
    }
  }, [market, pricingMethod, selectedRampExpiry, selectedMoveExpiry])

  // ─── Handlers ────────────────────────────────────────────────

  const handleTickerSelect = (t: string) => fetchData(t)

  const handleMarketChange = (newMarket: Market) => {
    setMarket(newMarket)
    setError(null)
    if (newMarket === 'INDIA') setPricingMethod('black-scholes')
    setCustomTickers([])
    const defaultTicker = newMarket === 'USA' ? 'SPX' : 'NIFTY'
    setTicker(defaultTicker)
    fetchData(defaultTicker, newMarket)
  }

  const handleAddTicker = (t: string) => {
    const formatted = t.trim().toUpperCase()
    if (!defaultTickers.includes(formatted) && !customTickers.includes(formatted)) {
      setCustomTickers(prev => [...prev, formatted])
      fetchData(formatted)
    }
  }

  const handleRemoveTicker = (t: string) => {
    if (customTickers.includes(t)) {
      setCustomTickers(prev => prev.filter(x => x !== t))
    }
    if (ticker === t) fetchData(defaultTickers[0])
  }

  const handlePricingMethodChange = (method: PricingMethod) => {
    setPricingMethod(method)
    if (ticker && !isLoading) fetchData(ticker)
  }

  const handleRefresh = () => fetchData(ticker)

  // Auto-load on mount
  useEffect(() => {
    fetchData(market === 'USA' ? 'SPX' : 'NIFTY')
  }, [])

  // ─── Render ──────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <TerminalHeader
        ticker={ticker}
        spotPrice={spotPrice}
        totalGEX={totalGEX}
        market={market}
        lastUpdated={lastUpdated}
        tickers={defaultTickers}
        customTickers={customTickers}
        onTickerSelect={handleTickerSelect}
        onMarketChange={handleMarketChange}
        onAddTicker={handleAddTicker}
        onRemoveTicker={handleRemoveTicker}
        onRefresh={handleRefresh}
      />

      {/* Stat Bar with Gauges */}
      {hasData && (
        <StatBar
          spotPrice={spotPrice}
          totalGEX={totalGEX}
          optionData={optionData}
          market={market}
          gammaFlipLevel={gammaFlipLevel}
        />
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-[#525252]">
            <div className="w-4 h-4 border-2 border-[#333] border-t-terminal-green rounded-full animate-spin" />
            <span className="text-sm font-mono">FETCHING {ticker}...</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="mx-4 lg:mx-6 mt-4 px-4 py-3 border border-terminal-red/20 bg-terminal-red/5 rounded">
          <div className="flex items-center justify-between">
            <span className="text-sm text-terminal-red font-mono">ERROR: {error}</span>
            <button
              onClick={handleRefresh}
              className="text-xs text-[#525252] hover:text-[#E5E5E5] font-mono border border-[#1A1A1A] px-2 py-1 rounded"
            >
              RETRY
            </button>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      {hasData && !isLoading && (
        <>
          <TabNavigation
            activeTab={activeTab}
            onTabChange={setActiveTab}
            tabs={TABS}
          />

          {/* Tab Content */}
          <div className="flex-1 p-4 lg:p-6">
            {/* ─── Option Chain ─── */}
            {activeTab === 'option-chain' && (
              <ChartWrapper
                title="Option Chain"
                subtitle="Complete option chain with Greeks, bid/ask spreads, and volume data"
                height="auto"
                controls={
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xxs text-[#525252] uppercase">Strikes</span>
                      <Select value={strikesCount.toString()} onValueChange={(v) => setStrikesCount(v === "ALL" ? "ALL" : parseInt(v))}>
                        <SelectTrigger className="w-16 h-7 text-xs bg-[#0A0A0A] border-[#1A1A1A]">
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
                    <div className="flex items-center gap-2">
                      <span className="text-xxs text-[#525252] uppercase">Expiry</span>
                      <Select value={selectedRampExpiry} onValueChange={setSelectedRampExpiry}>
                        <SelectTrigger className="w-36 h-7 text-xs bg-[#0A0A0A] border-[#1A1A1A]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {futureExpiries.map((exp) => (
                            <SelectItem key={exp} value={exp}>{exp}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                }
              >
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
              </ChartWrapper>
            )}

            {/* ─── GEX Profile (merged view) ─── */}
            {activeTab === 'gex-profile' && (
              <div className="space-y-4">
                {/* Sub-tab navigation + Expiry selector */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-0 border border-[#1A1A1A] rounded bg-[#0A0A0A] p-0.5">
                      {GEX_SUBTABS.map((st) => (
                        <button
                          key={st.id}
                          onClick={() => setGexSubTab(st.id)}
                          className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${
                            gexSubTab === st.id
                              ? 'bg-[#1A1A1A] text-[#E5E5E5]'
                              : 'text-[#525252] hover:text-[#737373]'
                          }`}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Controls for active sub-tab */}
                  <div className="flex items-center gap-3">
                    {gexSubTab === 'call-put-walls' && (
                      <div className="flex items-center gap-2">
                        <span className="text-xxs text-[#525252] uppercase">Wall Expiry</span>
                        <Select value={selectedWallExpiry} onValueChange={setSelectedWallExpiry}>
                          <SelectTrigger className="w-36 h-7 text-xs bg-[#0A0A0A] border-[#1A1A1A]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {futureExpiries.map((exp) => (
                              <SelectItem key={exp} value={exp}>{exp}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {gexSubTab === 'by-strike' && (
                      <PricingMethodToggle
                        pricingMethod={pricingMethod}
                        onPricingMethodChange={handlePricingMethodChange}
                      />
                    )}
                  </div>
                </div>

                {/* Expiry selector — shared for profile charts */}
                {(gexSubTab === 'by-strike' || gexSubTab === 'by-expiration' || gexSubTab === 'data-graph') && (
                  <ExpirySelector
                    availableExpiries={futureExpiries}
                    mode={expiryMode}
                    onModeChange={setExpiryMode}
                    selectedExpiries={customSelectedExpiries}
                    onSelectedExpiriesChange={setCustomSelectedExpiries}
                  />
                )}

                {/* Sub-tab content */}
                {gexSubTab === 'by-strike' && (
                  <ChartWrapper title="" height="700px">
                    <GEXByStrikeChart
                      data={optionData}
                      ticker={ticker}
                      spotPrice={spotPrice!}
                      selectedExpiries={activeExpiries}
                      pricingMethod={pricingMethod}
                      onPricingMethodChange={handlePricingMethodChange}
                      market={market}
                    />
                  </ChartWrapper>
                )}
                {gexSubTab === 'by-expiration' && (
                  <ChartWrapper
                    title="GEX by Expiration"
                    subtitle="Gamma exposure distribution across expiration dates"
                    height="500px"
                  >
                    <GEXByExpirationChart
                      data={optionData}
                      ticker={ticker}
                      selectedExpiries={activeExpiries}
                    />
                  </ChartWrapper>
                )}
                {gexSubTab === 'call-put-walls' && (
                  <ChartWrapper
                    title="Call / Put Walls"
                    subtitle="Open interest by strike — highlighting major call and put walls"
                    height="500px"
                  >
                    {selectedWallExpiry && (
                      <CallPutWallsChart
                        data={optionData}
                        ticker={ticker}
                        selectedExpiry={new Date(selectedWallExpiry)}
                      />
                    )}
                  </ChartWrapper>
                )}
                {gexSubTab === 'data-graph' && (
                  <ChartWrapper
                    title="GEX Data Graph"
                    subtitle="Total Gamma and Net Gamma by expiration date"
                    height="500px"
                  >
                    <GEXDataGraphDashboard data={optionData} />
                  </ChartWrapper>
                )}
              </div>
            )}

            {/* ─── GEX Surface ─── */}
            {activeTab === 'gex-surface' && (
              <div className="space-y-4">
                <ExpirySelector
                  availableExpiries={futureExpiries}
                  mode={expiryMode}
                  onModeChange={setExpiryMode}
                  selectedExpiries={customSelectedExpiries}
                  onSelectedExpiriesChange={setCustomSelectedExpiries}
                />
                <ChartWrapper
                  title="GEX Surface (3D)"
                  subtitle="Interactive 3D visualization across strike prices and expiration dates"
                  height="600px"
                >
                  <GEXSurfaceChart
                    data={optionData}
                    ticker={ticker}
                    spotPrice={spotPrice!}
                    selectedExpiries={activeExpiries}
                    onModeChange={setExpiryMode}
                    onSelectedExpiriesChange={setCustomSelectedExpiries}
                    availableExpiries={futureExpiries}
                  />
                </ChartWrapper>
              </div>
            )}

            {/* ─── Expected Move ─── */}
            {activeTab === 'expected-move' && (
              <ChartWrapper
                title="Expected Move"
                subtitle="Implied range based on the 16-delta strangle method"
                height="500px"
                controls={
                  <div className="flex items-center gap-2">
                    <span className="text-xxs text-[#525252] uppercase">Expiry</span>
                    <Select value={selectedMoveExpiry} onValueChange={setSelectedMoveExpiry}>
                      <SelectTrigger className="w-36 h-7 text-xs bg-[#0A0A0A] border-[#1A1A1A]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="All Dates">All Dates</SelectItem>
                        {futureExpiries.map((exp) => (
                          <SelectItem key={exp} value={exp}>{exp}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                }
              >
                <ExpectedMoveChart
                  data={optionData}
                  ticker={ticker}
                  spotPrice={spotPrice!}
                  selectedExpiry={selectedMoveExpiry}
                />
              </ChartWrapper>
            )}

            {/* ─── Time Machine ─── */}
            {activeTab === 'time-machine' && (
              <ChartWrapper
                title="Time Machine"
                subtitle="Replay historical GEX snapshots across time"
                height="auto"
              >
                <EnhancedTimeMachine ticker={ticker} />
              </ChartWrapper>
            )}
          </div>
        </>
      )}
    </div>
  )
}
