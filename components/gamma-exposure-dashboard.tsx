"use client"

import { useState, useCallback, useMemo, useEffect } from "react"
import type { OptionData } from "@/lib/types"
import { dataService, type Market } from "@/lib/data-service"
import { computeTotalGEX, findZeroGammaLevel, type PricingMethod } from "@/lib/calculations"

// Layout components
import { TerminalHeader } from "./layout/terminal-header"

// Chart components
import { SyncedStrikeWorkspace } from "./charts/synced-strike-workspace"
import { GradientChartsWorkspace } from "./charts/gradient-charts-workspace"
import { GEXByExpirationChart } from "./charts/gex-by-expiration-chart"
import { GEXSurfaceChart } from "./charts/gex-surface-chart"
import { IVSurfaceChart } from "./charts/iv-surface-chart"
import { CallPutWallsChart } from "./charts/call-put-walls-chart"
import { ExpectedMoveChart } from "./charts/expected-move-chart"
import { OptionChain } from "./charts/option-chain"
import { ChartWrapper } from "./charts/chart-wrapper"
import { PricingMethodToggle } from "./pricing-method-toggle"
import { SessionTimer } from "./session-timer"
import { FlowHistoricalView } from "./flow-historical-view"
import { ExpirySelector, type ExpiryMode, getOpexDte } from "./controls/expiry-selector"
import { HorizontalExpirySelector } from "./controls/horizontal-expiry-selector"
import { TradingJournal } from "./trading-journal/trading-journal"
import { OptionFlowDashboard } from "./option-flow-dashboard"
import { OptionNetFlowDashboard } from "./option-netflow-dashboard"
import { BacktestDashboard } from "./algorithms/backtest-dashboard"
import { StrategyStatsDashboard } from "./dashboard/strategy-stats-dashboard"
import { AIAnalystPanel } from "./AIAnalystPanel"
import { FloatingAskButton } from "./ui/floating-ask-button"
import { ProbabilityMapChart } from "./charts/probability-map-chart"
import { GarchForecastChart } from "./charts/garch-forecast-chart"
import { QuantumTunnelingGauge } from "./charts/quantum-tunneling-gauge"
import { CotFlowChart } from "./charts/cot-flow-chart"
import { GitaQuote } from "./layout/gita-quote"
import { ConfluenceHub } from "./confluence/confluence-hub"
import { createJournalTrade } from "@/lib/backend-api"

// UI components
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// ─── Sidebar Config ──────────────────────────────────────────────

const SIDEBAR_TABS = [
  { id: 'confluences', label: 'Confluence Hub', icon: 'confluence' },
  { id: 'gex', label: 'GEX Analytics', icon: 'gex' },
  { id: 'flow', label: 'Flow From Options', icon: 'flow' },
  { id: 'quant', label: 'Quant Pricing', icon: 'scanners' },
  { id: 'algos', label: 'Backtesting', icon: 'algos' },
  { id: 'journal', label: 'Journal', icon: 'calendar' },
  { id: 'stats', label: 'Strategy Stats', icon: 'stats' },
]

// ─── Sub-tabs Config per Sidebar Tab ─────────────────────────────

const SUB_TABS: { [key: string]: Array<{ id: string; label: string }> } = {
  gex: [
    { id: 'distribution', label: 'Distribution' },
    { id: 'projections', label: 'Projections' },
    { id: 'surfaces', label: 'Surfaces' },
  ],
  flow: [
    { id: 'live-tape', label: 'Live Tape' },
    { id: 'net-flow', label: 'Net Flow (EOD)' },
    { id: 'history-trend', label: 'History Trend' },
    { id: 'cot-positions', label: 'COT Positions' },
  ],
  quant: [
    { id: 'probability-map', label: 'Probability Map' },
    { id: 'garch-forecast', label: 'GARCH Forecast' },
    { id: 'quantum-tunnel', label: 'Quantum Tunnel' },
  ]
}


// ─── Ticker lists ────────────────────────────────────────────────

const USA_TICKERS = [
  "SPX", "SPY", "AAPL", "TSLA", "NVDA", "GOOGL", "MSFT", "QQQ",
  "GLD", "SLV", "PLTR", "MSTR", "GME", "SOFI",
]

const INDIA_TICKERS = [
  "NIFTY", "BANKNIFTY", "RELIANCE", "TCS", "INFY", "HDFCBANK",
  "ICICIBANK", "KOTAKBANK", "SBIN", "ITC", "LT",
]

export function GammaExposureDashboard() {
  // Navigation State
  const [activeSidebarTab, setActiveSidebarTab] = useState("confluences")
  const [activeTab, setActiveTab] = useState("distribution")

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

  // Sub-controls state
  const [selectedMoveExpiry, setSelectedMoveExpiry] = useState<string>("All Dates")
  const [selectedWallExpiry, setSelectedWallExpiry] = useState<string>("")
  const [strikesCount, setStrikesCount] = useState<number | "ALL">(12)
  const [selectedRampExpiry, setSelectedRampExpiry] = useState<string>("")
  const [activeZoom, setActiveZoom] = useState<number | null>(1) // Zoom percentage around spot
  const [isUpdating, setIsUpdating] = useState(false)

  // AI Analyst panel
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false)

  // Context & 0DTE mode states
  const [is0DteMode, setIs0DteMode] = useState<boolean>(false)
  const [uiContext, setUiContext] = useState<any | null>(null)

  // Expiry selector state
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>('0dte')
  const [customSelectedExpiries, setCustomSelectedExpiries] = useState<string[]>([])

  // Sync expiryMode with is0DteMode
  useEffect(() => {
    setIs0DteMode(expiryMode === '0dte')
  }, [expiryMode])

  // Trigger loading screen update on settings / expiry changes
  useEffect(() => {
    setIsUpdating(true)
    const timer = setTimeout(() => setIsUpdating(false), 350)
    return () => clearTimeout(timer)
  }, [ticker, expiryMode, market])

  // Set default zoom based on ticker (1% for SPX/SPY, 2% for others)
  useEffect(() => {
    if (ticker === 'SPX' || ticker === 'SPY' || ticker === 'NIFTY') {
      setActiveZoom(1)
    } else {
      setActiveZoom(2)
    }
  }, [ticker])

  // Watchlist configuration
  const defaultWatchlist = useMemo(() => {
    return market === 'USA' ? USA_TICKERS.slice(0, 5) : INDIA_TICKERS.slice(0, 5)
  }, [market])

  const watchlistTickers = useMemo(() => {
    return Array.from(new Set([...defaultWatchlist, ...customTickers]))
  }, [defaultWatchlist, customTickers])

  // Get real spot price for currently active ticker, or null/N/A for others (avoid mock data)
  const getWatchlistItem = useCallback((t: string): { price: number | null, pct: number | null } => {
    if (t === ticker && spotPrice !== null) {
      return { price: spotPrice, pct: null }
    }
    return { price: null, pct: null }
  }, [ticker, spotPrice])

  const watchlistData = useMemo(() => {
    return watchlistTickers.map(t => {
      const stats = getWatchlistItem(t)
      return {
        ticker: t,
        price: stats.price,
        pct: stats.pct,
      }
    })
  }, [watchlistTickers, getWatchlistItem])

  // Derived date collections
  const todayUTC = useMemo(() => {
    const d = new Date()
    d.setUTCHours(0, 0, 0, 0)
    return d
  }, [])

  const futureExpiries = useMemo(() => Array.from(
    new Set(
      optionData
        .map((opt) => opt.expiration)
        .filter((exp) => exp.getTime() >= todayUTC.getTime())
        .map((exp) => {
          const y = exp.getUTCFullYear()
          const m = String(exp.getUTCMonth() + 1).padStart(2, '0')
          const d = String(exp.getUTCDate()).padStart(2, '0')
          return `${y}-${m}-${d}`
        })
    )
  ).sort(), [optionData, todayUTC])

  // Compute active expiries based on mode
  const activeExpiries = useMemo(() => {
    const getDTE = (expStr: string) => {
      const parts = expStr.split('-')
      const expUTC = Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))
      const today = new Date()
      const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
      return Math.max(0, Math.round((expUTC - todayUTC) / 86400000))
    }

    if (expiryMode === '90d') {
      return futureExpiries.filter(exp => getDTE(exp) <= 90)
    }
    if (expiryMode === '0dte') {
      const today = futureExpiries.find(exp => getDTE(exp) === 0)
      if (today) return [today]
      return futureExpiries.length > 0 ? [futureExpiries[0]] : []
    }
    if (expiryMode === 'opex') {
      const opexDTE = getOpexDte()
      return futureExpiries.filter(exp => {
        const dte = getDTE(exp)
        return dte >= 0 && dte <= opexDTE
      })
    }
    return customSelectedExpiries
  }, [expiryMode, futureExpiries, customSelectedExpiries])

  // Moving filters below state declaration

  // Playback/Session timer states
  const [currentRange, setCurrentRange] = useState<[string | null, string | null]>([null, null])
  const [startOptionData, setStartOptionData] = useState<OptionData[]>([])
  const [endOptionData, setEndOptionData] = useState<OptionData[]>([])
  const [startSpotPrice, setStartSpotPrice] = useState<number | null>(null)
  const [endSpotPrice, setEndSpotPrice] = useState<number | null>(null)
  const [isLive, setIsLive] = useState(true)
  const [allTimestamps, setAllTimestamps] = useState<string[]>([])

  // Filter option chain contracts based on selected active expiries (0dte, 90d, or custom)
  const activeOptionData = useMemo(() => {
    if (activeExpiries.length === 0) return optionData
    return optionData.filter(o => activeOptionDataMatches(o.expiration, activeExpiries))
  }, [optionData, activeExpiries])

  const activeStartOptionData = useMemo(() => {
    if (activeExpiries.length === 0) return startOptionData
    return startOptionData.filter(o => activeOptionDataMatches(o.expiration, activeExpiries))
  }, [startOptionData, activeExpiries])

  const activeEndOptionData = useMemo(() => {
    if (activeExpiries.length === 0) return endOptionData
    return endOptionData.filter(o => activeOptionDataMatches(o.expiration, activeExpiries))
  }, [endOptionData, activeExpiries])

  function activeOptionDataMatches(expiration: Date, activeList: string[]): boolean {
    try {
      const y = expiration.getUTCFullYear()
      const m = String(expiration.getUTCMonth() + 1).padStart(2, '0')
      const d = String(expiration.getUTCDate()).padStart(2, '0')
      const expStr = `${y}-${m}-${d}`
      return activeList.includes(expStr)
    } catch {
      return false
    }
  }

  const gammaFlipLevel = useMemo(() => {
    if (!spotPrice || !activeOptionData.length) return null
    return findZeroGammaLevel(activeOptionData, spotPrice)
  }, [activeOptionData, spotPrice])

  const activeTotalGEX = useMemo(() => {
    if (!spotPrice || !activeOptionData.length) return 0
    return computeTotalGEX(spotPrice, activeOptionData, pricingMethod)
  }, [spotPrice, activeOptionData, pricingMethod])

  const hasData = spotPrice !== null && optionData.length > 0

  const fetchDashboardData = useCallback(async (
    selectedTicker: string,
    targetMarket?: Market,
    startTimestamp: string | null = null,
    isSilent: boolean = false,
    endTimestamp: string | null = null
  ) => {
    try {
      if (!isSilent) {
        setIsLoading(true)
      }
      setError(null)
      const mkt = targetMarket || market

      let startSnapshot = null
      let endSnapshot = null

      const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, '')

      const fetchSnapshot = async (ts: string | null) => {
        try {
          let url = `${BACKEND_URL}/api/current-data?ticker=${selectedTicker.toUpperCase()}`
          if (ts) {
            url = `${BACKEND_URL}/api/historical-data?ticker=${selectedTicker.toUpperCase()}&timestamp=${encodeURIComponent(ts)}`
          }
          const response = await fetch(url)
          if (response.ok) {
            const json = await response.json()
            return ts ? (json.data && json.data.length > 0 ? json.data[0] : null) : json.data
          }
        } catch (e) {
          console.warn("Error fetching snapshot from backend", e)
        }
        return null
      }

      if (startTimestamp && endTimestamp && startTimestamp !== endTimestamp) {
        const [startRes, endRes] = await Promise.all([
          fetchSnapshot(startTimestamp),
          fetchSnapshot(endTimestamp)
        ])
        startSnapshot = startRes
        endSnapshot = endRes
      } else {
        const ts = startTimestamp || endTimestamp
        const res = await fetchSnapshot(ts)
        startSnapshot = res
        endSnapshot = res
      }

      // Fallback to live frontend data fetch if no DB snapshot yet or backend failed
      if (!endSnapshot) {
        console.log(`No backend snapshot found for ${selectedTicker}. Falling back to live frontend fetch...`)
        const { spotPrice: sp, optionData: od } = await dataService.fetchOptionData(
          selectedTicker.toUpperCase(),
          mkt,
          pricingMethod
        )
        
        setTicker(selectedTicker.toUpperCase())
        setSpotPrice(sp)
        setOptionData(od)
        setStartOptionData(od)
        setEndOptionData(od)
        setStartSpotPrice(sp)
        setEndSpotPrice(sp)
        setTotalGEX(computeTotalGEX(sp, od, pricingMethod))
        setLastUpdated(new Date())
        setIsLive(true)
        setCurrentRange([null, null])
        
        // Auto-setup defaults
        const today = new Date()
        const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
        const expiries = Array.from(new Set(
          od.map((o: OptionData) => {
            const y = o.expiration.getUTCFullYear()
            const m = String(o.expiration.getUTCMonth() + 1).padStart(2, '0')
            const d = String(o.expiration.getUTCDate()).padStart(2, '0')
            return { expStr: `${y}-${m}-${d}`, time: o.expiration.getTime() }
          })
          .filter((item: { expStr: string; time: number }) => item.time >= todayUTC)
          .map((item: { expStr: string; time: number }) => item.expStr)
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
        return
      }

      // Map backend OptionData to frontend OptionData
      const mapOptions = (snapshot: any): OptionData[] => {
        if (!snapshot || !snapshot.options) return []
        return snapshot.options.map((opt: any) => ({
          option: opt.option || `${selectedTicker}-${opt.strike}-${opt.option_type || opt.type}`,
          type: opt.type || opt.option_type,
          strike: parseFloat(opt.strike),
          expiration: new Date(opt.expiration),
          gamma: parseFloat(opt.gamma || 0),
          open_interest: parseInt(opt.openInterest || opt.open_interest || 0, 10),
          volume: parseInt(opt.volume || 0, 10),
          iv: parseFloat(opt.impliedVolatility || opt.implied_volatility || opt.iv || 0) * 100, // fraction to percent
          delta: parseFloat(opt.delta || 0),
          bid: parseFloat(opt.bid || 0),
          ask: parseFloat(opt.ask || 0),
          last: parseFloat(opt.last || opt.lastPrice || opt.last_price || 0),
        }))
      }

      const startMapped = mapOptions(startSnapshot)
      const endMapped = mapOptions(endSnapshot)

      setTicker(selectedTicker.toUpperCase())
      
      const startSp = startSnapshot ? startSnapshot.spotPrice : endSnapshot.spotPrice
      const endSp = endSnapshot.spotPrice

      setStartSpotPrice(startSp)
      setStartOptionData(startMapped)
      
      setEndSpotPrice(endSp)
      setEndOptionData(endMapped)

      // Main compatibility states mapped to the end snapshot
      setSpotPrice(endSp)
      setOptionData(endMapped)
      setTotalGEX(computeTotalGEX(endSp, endMapped, pricingMethod))
      setLastUpdated(new Date(endSnapshot.timestamp))
      
      // Update current range
      const startTs = startSnapshot ? startSnapshot.timestamp : endSnapshot.timestamp
      const endTs = endSnapshot.timestamp
      setCurrentRange([startTs, endTs])

      // Update expiry defaults (completely timezone-independent UTC-matching calendar check)
      const today = new Date()
      const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())

      const expiries = Array.from(new Set(
        endMapped.map((o: OptionData) => {
          const y = o.expiration.getUTCFullYear()
          const m = String(o.expiration.getUTCMonth() + 1).padStart(2, '0')
          const d = String(o.expiration.getUTCDate()).padStart(2, '0')
          return { expStr: `${y}-${m}-${d}`, time: o.expiration.getTime() }
        })
        .filter((item: { expStr: string; time: number }) => item.time >= todayUTC)
        .map((item: { expStr: string; time: number }) => item.expStr)
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
      if (msg.includes("Failed to fetch")) setError("Unable to connect CBOE dataset.")
      else if (msg.includes("404") || msg.includes("not found")) setError(`Ticker "${selectedTicker}" not found.`)
      else if (msg.includes("500")) setError("Server response error. Try again shortly.")
      else setError(msg)
    } finally {
      if (!isSilent) {
        setIsLoading(false)
      }
    }
  }, [market, pricingMethod, selectedRampExpiry, selectedMoveExpiry])

  // ─── Handlers ────────────────────────────────────────────────

  const handleTickerSelect = (t: string) => {
    setIsLive(true)
    fetchDashboardData(t, undefined, null, false)
  }

  const handleCheckpointChange = useCallback((start: string | null, end: string | null, isCheckpointLive: boolean) => {
    setIsLive(isCheckpointLive)
    fetchDashboardData(ticker, undefined, start, true, end)
  }, [ticker, fetchDashboardData])

  const handleSingleCheckpointChange = useCallback((ts: string | null, isCheckpointLive: boolean) => {
    setIsLive(isCheckpointLive)
    if (ts) {
      fetchDashboardData(ticker, undefined, ts, true, ts)
    }
  }, [ticker, fetchDashboardData])

  const handleMarketChange = (newMarket: Market) => {
    setMarket(newMarket)
    setError(null)
    if (newMarket === 'INDIA') setPricingMethod('black-scholes')
    setCustomTickers([])
    const defaultTicker = newMarket === 'USA' ? 'SPX' : 'NIFTY'
    setTicker(defaultTicker)
    setIsLive(true)
    fetchDashboardData(defaultTicker, newMarket, null, false)
  }

  const handleAddTickerSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const input = form.elements.namedItem("tickerSearch") as HTMLInputElement
    const val = input.value.trim().toUpperCase()
    if (val && !watchlistTickers.includes(val)) {
      setCustomTickers(prev => [...prev, val])
      setIsLive(true)
      fetchDashboardData(val, undefined, null, false)
    }
    form.reset()
  }

  const handleRemoveCustomTicker = (t: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setCustomTickers(prev => prev.filter(x => x !== t))
    if (ticker === t) {
      setIsLive(true)
      fetchDashboardData(defaultWatchlist[0], undefined, null, false)
    }
  }

  const handleRefresh = () => {
    fetchDashboardData(ticker, undefined, isLive ? null : currentRange[0], false, isLive ? null : currentRange[1])
  }

  const handlePricingMethodChange = (newMethod: PricingMethod) => {
    setPricingMethod(newMethod)
  }

  // Refetch when pricing method changes
  useEffect(() => {
    if (ticker) {
      fetchDashboardData(ticker, undefined, isLive ? null : currentRange[0], true, isLive ? null : currentRange[1])
    }
  }, [pricingMethod])

  // Load initial data
  useEffect(() => {
    fetchDashboardData(market === 'USA' ? 'SPX' : 'NIFTY', undefined, null, false)
  }, [])

  return (
    <div className="h-screen w-screen bg-black flex flex-col md:flex-row overflow-hidden select-none">
      {/* ─── LEFT ICON NAVIGATION SIDEBAR (DESKTOP) ─── */}
      <aside className="hidden md:flex w-16 bg-[#08080A] border-r border-[#15151A] flex-col items-center py-5 flex-shrink-0 justify-between select-none h-full">
        <div className="flex flex-col items-center gap-5 w-full">
          {SIDEBAR_TABS.map(tab => {
            const active = activeSidebarTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveSidebarTab(tab.id)
                  if (tab.id === 'gex') setActiveTab('distribution')
                  else if (tab.id === 'flow') setActiveTab('live-tape')
                  else if (tab.id === 'quant') setActiveTab('probability-map')
                }}
                className="group flex flex-col items-center gap-1 w-full relative transition-all py-2"
                title={tab.label}
              >
                {/* Active bottom underline instead of left bar */}
                {active && (
                  <div className="absolute bottom-0.5 w-7 h-[2px] bg-terminal-green rounded shadow-[0_0_8px_#00FF88]" />
                )}

                {/* Tab Icon - No border, clean icon */}
                <div className={`w-8 h-8 flex items-center justify-center transition-all duration-200 ${
                  active
                    ? 'text-terminal-green scale-105'
                    : 'text-[#444] group-hover:text-[#949499]'
                }`}>
                  {tab.icon === 'confluence' && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9s2.015-9 4.5-9m0 0a9.004 9.004 0 018.716 6.747M12 3a9.004 9.004 0 00-8.716 6.747" />
                    </svg>
                  )}
                  {tab.icon === 'gex' && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                    </svg>
                  )}
                  {tab.icon === 'flow' && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                    </svg>
                  )}
                  {tab.icon === 'scanners' && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 21m0 0l-.813-5.096M9 21h3.75M9 21H5.25M12 3c-4.97 0-9 4.03-9 9 0 2.12.735 4.07 1.962 5.617a9.047 9.047 0 005.122-5.122 3.003 3.003 0 115.632 0 9.047 9.047 0 005.122 5.122A8.96 8.96 0 0021 12c0-4.97-4.03-9-9-9z" />
                    </svg>
                  )}
                  {tab.icon === 'screener' && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c-1.2 0-2.4 1.05-3 2.25L4.5 13.5A3 3 0 007 18h10a3 3 0 002.5-4.5L15 5.25c-.6-1.2-1.8-2.25-3-2.25z" />
                    </svg>
                  )}
                  {tab.icon === 'calendar' && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
                    </svg>
                  )}
                  {tab.icon === 'algos' && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                    </svg>
                  )}
                  {tab.icon === 'stats' && (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
                    </svg>
                  )}
                </div>

                {/* Tab Label */}
                <span className={`text-[9px] font-mono leading-none tracking-tight font-medium pb-2 transition-colors duration-200 ${
                  active ? 'text-[#E5E5E5]' : 'text-[#444] group-hover:text-[#888]'
                }`}>
                  {tab.label.split(' ')[0]}
                </span>
              </button>
            )
          })}
        </div>

        {/* Stylized Brand Logo (Γ for Gamma) at the bottom */}
        <div className="w-10 h-10 rounded-xl bg-gradient-to-b from-[#121216] to-[#08080a] border border-[#1d1d24] flex items-center justify-center mb-2 shadow-[0_4px_12px_rgba(0,0,0,0.6)]">
          <span className="text-terminal-green font-mono font-black text-base tracking-tighter">Γ</span>
        </div>
      </aside>

      {/* ─── BOTTOM ICON NAVIGATION BAR (MOBILE) ─── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#08080A] border-t border-[#15151A] z-40 flex flex-row justify-around items-center px-2 select-none">
        {SIDEBAR_TABS.map(tab => {
          const active = activeSidebarTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveSidebarTab(tab.id)
                if (tab.id === 'gex') setActiveTab('distribution')
                else if (tab.id === 'flow') setActiveTab('live-tape')
                else if (tab.id === 'quant') setActiveTab('probability-map')
              }}
              className="group flex flex-col items-center justify-center gap-1 w-12 relative h-full py-1.5"
            >
              {/* Active bottom underline */}
              {active && (
                <div className="absolute bottom-1 w-6 h-[2px] bg-terminal-green rounded shadow-[0_0_8px_#00FF88]" />
              )}

              <div className={`w-8 h-8 flex items-center justify-center transition-all duration-200 ${
                active
                  ? 'text-terminal-green scale-105'
                  : 'text-[#555]'
              }`}>
                {tab.icon === 'confluence' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9s2.015-9 4.5-9m0 0a9.004 9.004 0 018.716 6.747M12 3a9.004 9.004 0 00-8.716 6.747" />
                  </svg>
                )}
                {tab.icon === 'gex' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                )}
                {tab.icon === 'flow' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                  </svg>
                )}
                {tab.icon === 'scanners' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 21m0 0l-.813-5.096M9 21h3.75M9 21H5.25M12 3c-4.97 0-9 4.03-9 9 0 2.12.735 4.07 1.962 5.617a9.047 9.047 0 005.122-5.122 3.003 3.003 0 115.632 0 9.047 9.047 0 005.122 5.122A8.96 8.96 0 0021 12c0-4.97-4.03-9-9-9z" />
                  </svg>
                )}
                {tab.icon === 'screener' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c-1.2 0-2.4 1.05-3 2.25L4.5 13.5A3 3 0 007 18h10a3 3 0 002.5-4.5L15 5.25c-.6-1.2-1.8-2.25-3-2.25z" />
                  </svg>
                )}
                {tab.icon === 'calendar' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
                  </svg>
                )}
                {tab.icon === 'algos' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                  </svg>
                )}
                {tab.icon === 'stats' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
                  </svg>
                )}
              </div>
              <span className={`text-[8.5px] font-mono leading-none tracking-tight pb-1.5 transition-colors duration-200 ${
                active ? 'text-[#E5E5E5]' : 'text-[#444]'
              }`}>
                {tab.label.split(' ')[0]}
              </span>
            </button>
          )
        })}
      </nav>

      {/* ─── MAIN WORKSPACE AND CONTENT GRID ─── */}
      <main className="flex-1 flex flex-col min-w-0 pb-16 md:pb-0 overflow-hidden">
        {/* Terminal Header (Hidden inside Journal and Flow tabs) */}
        {activeSidebarTab !== 'journal' && activeSidebarTab !== 'flow' && (
          <TerminalHeader
            ticker={ticker}
            spotPrice={spotPrice}
            market={market}
            lastUpdated={lastUpdated}
            onTickerSelect={handleTickerSelect}
            onMarketChange={handleMarketChange}
            onRefresh={handleRefresh}
            totalGEX={activeTotalGEX}
            optionData={activeOptionData}
            gammaFlipLevel={gammaFlipLevel}
            isAIPanelOpen={isAIPanelOpen}
            onToggleAIPanel={() => setIsAIPanelOpen(v => !v)}
            watchlist={watchlistData}
          />
        )}

        {/* Session timer is now rendered directly inside GEX Levels tab */}



        {/* Workspace body */}
        <div className="flex-1 flex flex-row min-h-0 bg-[#020203]">
          {/* Main Chart content area */}
          <div className="flex-1 flex flex-col min-w-0 h-full">
            {/* Loading state */}
            {isLoading && (
              <div className="flex-1 flex items-center justify-center">
                <div className="flex items-center gap-3 text-[#949494]">
                  <div className="w-4 h-4 border-2 border-[#151515] border-t-terminal-green rounded-full animate-spin" />
                  <span className="text-sm font-mono tracking-widest">LOADING TERMINAL SNAPSHOT...</span>
                </div>
              </div>
            )}

            {/* Error state */}
            {error && !isLoading && activeSidebarTab === 'gex' && (
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="max-w-md w-full border border-terminal-red/25 bg-terminal-red/5 rounded-lg p-5 flex flex-col gap-4">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-terminal-red animate-pulse" />
                    <span className="text-sm font-bold font-mono text-terminal-red">CONNECTION EXCEPTION</span>
                  </div>
                  <p className="text-xs font-mono text-[#888] leading-relaxed">
                    {error}
                  </p>
                  <button
                    onClick={handleRefresh}
                    className="self-end px-3 py-1 bg-terminal-red/10 border border-terminal-red/35 hover:bg-terminal-red/20 transition-all rounded text-xs font-mono text-terminal-red"
                  >
                    RETRY PIPELINE
                  </button>
                </div>
              </div>
            )}

            {/* Confluence Hub Workspace */}
            {activeSidebarTab === 'confluences' && !isLoading && (
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <ConfluenceHub
                  ticker={ticker}
                  market={market}
                  spotPrice={spotPrice}
                  optionData={activeOptionData}
                  pricingMethod={pricingMethod}
                  totalGEX={activeTotalGEX}
                  gammaFlipLevel={gammaFlipLevel}
                  onLogJournalTrade={async (trade) => {
                    try {
                      const journalTrade = {
                        id: `SB-${Date.now()}`,
                        tradeDate: trade.date,
                        timeEntered: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
                        timeExited: null,
                        ticker: trade.ticker,
                        tradeType: 'Option' as const,
                        direction: 'Buy' as const,
                        quality: 'A' as const,
                        pnl: 0,
                        pnlPercent: 0,
                        rationale: trade.notes,
                        strategy: trade.strategy,
                        quantity: 1,
                        entryPrice: trade.entryPrice,
                        exitPrice: 0,
                        status: 'Open' as const
                      }
                      await createJournalTrade(journalTrade)
                    } catch (e) {
                      console.error("Error creating journal trade:", e)
                    }
                  }}
                />
              </div>
            )}

            {/* Trading Journal Workspace */}
            {activeSidebarTab === 'journal' && (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden h-full">
                <TradingJournal />
              </div>
            )}

            {/* Algorithms Backtesting Workspace */}
            {activeSidebarTab === 'algos' && (
              <BacktestDashboard />
            )}

            {/* Strategy Stats Workspace */}
            {activeSidebarTab === 'stats' && (
              <div className="flex-1 flex flex-col min-h-0 overflow-y-auto h-full p-4">
                <StrategyStatsDashboard />
              </div>
            )}

            {/* Unified Workspace Shell for GEX, Flow, and Quant */}
            {(activeSidebarTab === 'gex' || activeSidebarTab === 'flow' || activeSidebarTab === 'quant') && !isLoading && (
              <div className="flex-1 flex flex-col min-h-0">
                {/* TOP WORKSPACE NAVIGATION TABS */}
                <div className="border-b border-[#1A1A1E] bg-[#08080A] flex items-center px-4 py-2 justify-between select-none flex-shrink-0 gap-4">
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {SUB_TABS[activeSidebarTab]?.map(tab => {
                      const active = activeTab === tab.id
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={`px-3 py-1.5 text-xs font-mono font-bold rounded transition-all border ${
                            active
                              ? 'bg-[#121215] text-terminal-green border-[#25252E] shadow-sm'
                              : 'bg-transparent text-[#949494] border-transparent hover:text-[#888]'
                          }`}
                        >
                          {tab.label}
                        </button>
                      )
                    })}
                  </div>

                  {/* Horizontal Expiry Selector in the header */}
                  {(activeSidebarTab === 'gex' || (activeSidebarTab === 'quant' && activeTab === 'quantum-tunnel') || (activeSidebarTab === 'flow' && activeTab === 'net-flow')) && futureExpiries.length > 0 && (
                    <div className="flex-1 min-w-0">
                      <HorizontalExpirySelector
                        availableExpiries={futureExpiries}
                        mode={expiryMode}
                        onModeChange={setExpiryMode}
                        selectedExpiries={customSelectedExpiries}
                        onSelectedExpiriesChange={setCustomSelectedExpiries}
                        optionData={optionData}
                      />
                    </div>
                  )}
                </div>

                {/* Workspace tab views with loading screen overlay */}
                <div className={`flex-1 overflow-y-auto terminal-scrollbar relative ${
                  (activeSidebarTab === 'quant' && (activeTab === 'garch-forecast' || activeTab === 'probability-map')) ||
                  (activeSidebarTab === 'flow' && (activeTab === 'cot-positions' || activeTab === 'net-flow' || activeTab === 'live-tape'))
                    ? 'p-0 space-y-0'
                    : 'p-4 space-y-4'
                }`}>
                  {isUpdating && (
                    <div className="absolute inset-0 bg-black/85 backdrop-blur-sm z-50 flex flex-col items-center justify-center transition-all duration-300">
                      <div className="flex items-center gap-3 text-terminal-green">
                        <div className="w-4 h-4 border-2 border-transparent border-t-terminal-green rounded-full animate-spin" />
                        <span className="text-xs font-mono tracking-widest uppercase">UPDATING TERMINAL SNAPSHOT...</span>
                      </div>
                    </div>
                  )}

                  {/* ==================== 1. GEX Analytics sub-tabs ==================== */}
                  {activeSidebarTab === 'gex' && (
                    <>
                      {!hasData ? (
                        <div className="flex-1 flex items-center justify-center text-xs font-mono text-[#555] py-20">
                          No GEX/options data available for ticker {ticker}. Please collect data first.
                        </div>
                      ) : (
                        <>
                          {/* Distribution Sub-tab */}
                          {activeTab === 'distribution' && (
                            <div className="flex flex-col gap-4 min-h-0 w-full">
                              {/* Main charts column */}
                              <div className="w-full flex flex-col gap-4 min-w-0">
                                {/* Session Range Slider */}
                                <SessionTimer
                                  ticker={ticker}
                                  currentRange={currentRange}
                                  onCheckpointChange={handleCheckpointChange}
                                  isLive={isLive}
                                  onLiveChange={setIsLive}
                                  onTimestampsLoad={setAllTimestamps}
                                />

                                {/* Synced Workspace Chart Card */}
                                <div 
                                  className="bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg p-3"
                                  data-ai-context={JSON.stringify({
                                    component: "Synced Strike Workspace",
                                    promptTemplate: "Analyze the strike levels and GEX clusters on the Synced Strike Workspace chart."
                                  })}
                                >
                                  <div className="h-[calc(100vh-180px)] min-h-[580px]">
                                    <SyncedStrikeWorkspace
                                      startOptionData={activeStartOptionData}
                                      endOptionData={activeEndOptionData}
                                      ticker={ticker}
                                      startSpotPrice={startSpotPrice ?? spotPrice!}
                                      endSpotPrice={endSpotPrice ?? spotPrice!}
                                      market={market}
                                      pricingMethod={pricingMethod}
                                      expiryMode={expiryMode}
                                      isLive={isLive}
                                      availableExpiries={futureExpiries}
                                      selectedExpiries={customSelectedExpiries}
                                      onSelectedExpiriesChange={setCustomSelectedExpiries}
                                      onExpiryModeChange={setExpiryMode}
                                    />
                                  </div>
                                </div>

                                {/* Option Chain Card below */}
                                <div
                                  data-ai-context={JSON.stringify({
                                    component: "Option Chain Grid",
                                    promptTemplate: "Explain the option chain positioning, call/put wall structure, and open interest concentration."
                                  })}
                                >
                                  <ChartWrapper
                                    title="Option Chain Grid"
                                    subtitle="Detailed strike levels, Greeks, and open interest distribution"
                                    height="auto"
                                    controls={
                                      <div className="flex items-center gap-3">
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] text-[#949494] font-mono uppercase">Strikes</span>
                                          <Select value={strikesCount.toString()} onValueChange={(v) => setStrikesCount(v === "ALL" ? "ALL" : parseInt(v))}>
                                            <SelectTrigger className="w-16 h-6 text-[10px] bg-black border-[#1A1A1E]">
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-black border-[#1A1A1E]">
                                              <SelectItem value="6">6</SelectItem>
                                              <SelectItem value="10">10</SelectItem>
                                              <SelectItem value="12">12</SelectItem>
                                              <SelectItem value="16">16</SelectItem>
                                              <SelectItem value="20">20</SelectItem>
                                              <SelectItem value="ALL">ALL</SelectItem>
                                            </SelectContent>
                                          </Select>
                                        </div>
                                        <PricingMethodToggle pricingMethod={pricingMethod} onPricingMethodChange={handlePricingMethodChange} />
                                      </div>
                                    }
                                  >
                                    <OptionChain
                                      data={optionData}
                                      ticker={ticker}
                                      spotPrice={spotPrice!}
                                      selectedExpiry={selectedWallExpiry}
                                      onExpiryChange={setSelectedWallExpiry}
                                      availableExpiries={futureExpiries}
                                      strikesCount={strikesCount}
                                      onStrikesCountChange={setStrikesCount}
                                    />
                                  </ChartWrapper>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Projections Sub-tab */}
                          {activeTab === 'projections' && (
                            <div className="flex flex-col gap-4">
                              {/* Expected Move Card */}
                              <div
                                data-ai-context={JSON.stringify({
                                  component: "Implied Expected Move Ranges",
                                  promptTemplate: "Explain the Expected Move chart. What are the key boundaries and market expectations?"
                                })}
                              >
                                <ChartWrapper
                                  title="Implied Expected Move Ranges"
                                  subtitle="Implied boundaries calculated via 16-delta strangle options method"
                                  height="600px"
                                  controls={
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-[#949494] font-mono uppercase font-bold">Expiry</span>
                                      <Select value={selectedMoveExpiry} onValueChange={setSelectedMoveExpiry}>
                                        <SelectTrigger className="w-32 h-6 text-[10px] bg-black border-[#1A1A1E]">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="bg-black border-[#1A1A1E]">
                                          <SelectItem value="All Dates">All Dates</SelectItem>
                                          {futureExpiries.map((exp) => (
                                            <SelectItem key={exp} value={exp}>{exp.slice(5)}</SelectItem>
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
                              </div>

                              {/* Vanna/Charm Greek Gradients */}
                              <div 
                                className="h-[1200px] w-full"
                                data-ai-context={JSON.stringify({
                                  component: "Greek Gradient Heatmaps",
                                  promptTemplate: "Interpret the Greek Gradient Heatmaps for Vanna and Charm. What do they tell us about dealer positioning and flows?"
                                })}
                              >
                                <GradientChartsWorkspace
                                  optionData={activeOptionData}
                                  ticker={ticker}
                                  spotPrice={spotPrice!}
                                  market={market}
                                  pricingMethod={pricingMethod}
                                />
                              </div>
                            </div>
                          )}

                          {/* Surfaces Sub-tab */}
                          {activeTab === 'surfaces' && (
                            <div className="flex flex-col lg:flex-row gap-4 min-h-0">
                              {/* Left side: Charts */}
                              <div className="flex-1 grid grid-cols-1 xl:grid-cols-2 gap-4 min-w-0">
                                <div
                                  data-ai-context={JSON.stringify({
                                    component: "3D Gamma Exposure Surface",
                                    promptTemplate: "Explain the 3D Gamma Exposure Surface chart and what the GEX curves tell us about volatility regimes."
                                  })}
                                >
                                  <ChartWrapper
                                    title="3D Gamma Exposure Surface"
                                    subtitle="Interactive 3D GEX mapping strike price and expiration date curves"
                                    height="550px"
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
                                <div
                                  data-ai-context={JSON.stringify({
                                    component: "3D Implied Volatility Surface",
                                    promptTemplate: "Explain the 3D Implied Volatility Surface chart. What does the volatility term structure and skew look like?"
                                  })}
                                >
                                  <ChartWrapper
                                    title="3D Implied Volatility Surface"
                                    subtitle="Interactive 3D IV mapping strike price and expiration date curves"
                                    height="550px"
                                  >
                                    <IVSurfaceChart
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
                              </div>

                              {/* Expiry selector moved to header */}
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}

                  {/* ==================== 2. Options Flow sub-tabs ==================== */}
                  {activeSidebarTab === 'flow' && activeTab === 'live-tape' && (
                    <div className="flex-1 flex flex-col min-h-0 bg-[#020203]">
                      <OptionFlowDashboard 
                        ticker={ticker}
                        onTickerSelect={handleTickerSelect}
                        availableTickers={watchlistTickers}
                      />
                    </div>
                  )}
                  {activeSidebarTab === 'flow' && activeTab === 'net-flow' && (
                    <div className="flex-1 flex flex-col min-h-0 bg-[#020203]">
                      <OptionNetFlowDashboard 
                        ticker={ticker}
                        selectedExpiries={activeExpiries}
                      />
                    </div>
                  )}
                  {activeSidebarTab === 'flow' && activeTab === 'history-trend' && (
                    <div className="flex-1 p-4 overflow-y-auto">
                      <FlowHistoricalView
                        ticker={ticker}
                        currentTimestamp={currentRange[1]}
                        onCheckpointChange={handleSingleCheckpointChange}
                        isLive={isLive}
                        setIsLive={setIsLive}
                        parentLoading={isLoading}
                      />
                    </div>
                  )}
                  {activeSidebarTab === 'flow' && activeTab === 'cot-positions' && (
                    <div 
                      className="flex-1 flex flex-col min-h-0"
                      data-ai-context={JSON.stringify({
                        component: "COT Flow Chart",
                        promptTemplate: "Analyze the Commitment of Traders (COT) long/short institutional positioning dynamics and Net GEX flow trend."
                      })}
                    >
                      <CotFlowChart />
                    </div>
                  )}

                  {/* ==================== 3. Quant Pricing sub-tabs ==================== */}
                  {activeSidebarTab === 'quant' && activeTab === 'probability-map' && (
                    <div 
                      className="flex-1 flex flex-col min-h-0"
                      data-ai-context={JSON.stringify({
                        component: "Probability Map Chart",
                        promptTemplate: "Analyze the Breeden-Litzenberger implied probability density function (PDF) moments (mean, stdDev, skewness, kurtosis) across different DTE slices on this 3D map."
                      })}
                    >
                      <ProbabilityMapChart
                        ticker={ticker}
                        optionData={optionData}
                        spotPrice={spotPrice!}
                        futureExpiries={futureExpiries}
                      />
                    </div>
                  )}
                  {activeSidebarTab === 'quant' && activeTab === 'garch-forecast' && (
                    <div 
                      className="flex-1 flex flex-col min-h-0"
                      data-ai-context={JSON.stringify({
                        component: "GARCH Volatility Forecast Chart",
                        promptTemplate: "Analyze the GARCH(1,1) volatility term structure forecast versus option implied volatilities for this ticker."
                      })}
                    >
                      <GarchForecastChart ticker={ticker} />
                    </div>
                  )}
                  {activeSidebarTab === 'quant' && activeTab === 'quantum-tunnel' && (
                    <div 
                      className="flex-1 flex flex-col min-h-0 p-4 gap-4 overflow-y-auto terminal-scrollbar"
                      data-ai-context={JSON.stringify({
                        component: "Quantum Tunneling Gauge",
                        promptTemplate: "Explain the quantum barrier breakthrough and tunneling probability calculations for the call/put walls based on Schrödinger wave equation modeling."
                      })}
                    >
                      <QuantumTunnelingGauge 
                        ticker={ticker} 
                        activeExpiries={activeExpiries} 
                        expiryMode={expiryMode} 
                        optionData={activeOptionData}
                        spotPrice={spotPrice}
                        pricingMethod={pricingMethod}
                      />
                      <div className="flex-shrink-0 bg-[#070709] border border-[#141416] rounded-lg p-3 flex flex-col gap-3">
                        <div className="flex items-center justify-between border-b border-[#141416] pb-2 flex-shrink-0">
                          <div>
                            <h2 className="text-xs font-mono font-bold text-[#E5E5E5] tracking-wider uppercase">GEX & Volume Profile Reference</h2>
                            <p className="text-[10px] font-mono text-[#555] mt-0.5">Strikes GEX and Volume distribution overlay</p>
                          </div>
                        </div>
                        <div className="h-[620px] w-full">
                          <SyncedStrikeWorkspace
                            startOptionData={activeStartOptionData}
                            endOptionData={activeEndOptionData}
                            ticker={ticker}
                            startSpotPrice={startSpotPrice ?? spotPrice!}
                            endSpotPrice={endSpotPrice ?? spotPrice!}
                            market={market}
                            pricingMethod={pricingMethod}
                            expiryMode={expiryMode}
                            isLive={isLive}
                            defaultRotated={true}
                            defaultCandlesCollapsed={true}
                            availableExpiries={futureExpiries}
                            selectedExpiries={customSelectedExpiries}
                            onSelectedExpiriesChange={setCustomSelectedExpiries}
                            onExpiryModeChange={setExpiryMode}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* AI Analyst Panel — GEX mode with Briefing + Chat */}
          {activeSidebarTab !== 'journal' && (
            <AIAnalystPanel
              isOpen={isAIPanelOpen}
              onClose={() => setIsAIPanelOpen(false)}
              optionData={activeOptionData}
              ticker={ticker}
              livePrice={spotPrice ?? undefined}
              timeframe="Intraday"
              showBriefingTab={true}
              title="GEX AI ANALYST"
              inputPlaceholder="Ask about GEX, gamma flip, options positioning..."
              is0DteMode={is0DteMode}
              on0DteModeChange={(val) => {
                setIs0DteMode(val)
                if (val) {
                  setExpiryMode('0dte')
                } else {
                  if (expiryMode === '0dte') {
                    setExpiryMode('90d')
                  }
                }
              }}
              uiContext={uiContext}
              onClearUiContext={() => setUiContext(null)}
            />
          )}
        </div>

        {/* Bhagvad Gita Financial Shlokas Banner */}
        <div className="p-3 bg-[#020203] border-t border-[#141416] flex-shrink-0">
          <GitaQuote />
        </div>
      </main>

      {/* Floating Ask AI Button */}
      <FloatingAskButton 
        onTriggerAI={(context) => {
          setUiContext(context)
          setIsAIPanelOpen(true)
        }}
      />
    </div>
  )
}

