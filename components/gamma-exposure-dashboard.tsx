"use client"

import { useState, useCallback, useMemo, useEffect } from "react"
import type { OptionData } from "@/lib/types"
import { dataService, type Market } from "@/lib/data-service"
import { computeTotalGEX, findZeroGammaLevel, type PricingMethod } from "@/lib/calculations"

// Layout components
import { TerminalHeader } from "./layout/terminal-header"

// Chart components
import { SyncedStrikeWorkspace } from "./charts/synced-strike-workspace"
import { GEXByStrikeChart } from "./charts/gex-by-strike-chart"
import { GradientChartsWorkspace } from "./charts/gradient-charts-workspace"
import { GEXByExpirationChart } from "./charts/gex-by-expiration-chart"
import { GEXSurfaceChart } from "./charts/gex-surface-chart"
import { CallPutWallsChart } from "./charts/call-put-walls-chart"
import { ExpectedMoveChart } from "./charts/expected-move-chart"
import { OptionChain } from "./charts/option-chain"
import { GEXDataGraphDashboard } from "./charts/gex-data-graph-dashboard"
import { ChartWrapper } from "./charts/chart-wrapper"
import { PricingMethodToggle } from "./pricing-method-toggle"
import { SessionTimer } from "./session-timer"
import { FlowHistoricalView } from "./flow-historical-view"
import { ExpirySelector, type ExpiryMode, getOpexDte } from "./controls/expiry-selector"
import { TradingJournal } from "./trading-journal/trading-journal"
import { OptionFlowDashboard } from "./option-flow-dashboard"

// UI components
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// ─── Sidebar Config ──────────────────────────────────────────────

const SIDEBAR_TABS = [
  { id: 'gex', label: 'Gex', icon: 'gex' },
  { id: 'flow', label: 'Option Flow', icon: 'flow' },
  { id: 'scanners', label: 'Scanners', icon: 'scanners' },
  { id: 'screener', label: 'Screener', icon: 'screener' },
  { id: 'journal', label: 'Journal', icon: 'calendar' },
  { id: 'algos', label: 'Algorithms', icon: 'algos' },
]

// ─── GEX Bottom sub-tabs ─────────────────────────────────────────

const BOTTOM_TABS = [
  { id: 'gex-levels', label: 'GEX Levels' },
  { id: 'flow-historical', label: 'Flow/Historical' },
  { id: 'gradient-charts', label: 'Gradient View' },
  { id: 'data-graph', label: 'Data Graph' },
  { id: 'surface', label: '3D Surface Model' },
  { id: 'expected-move', label: 'Expected Move' },
]

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
  const [activeSidebarTab, setActiveSidebarTab] = useState("gex")
  const [activeTab, setActiveTab] = useState("gex-levels")

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

  // Expiry selector state
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>('0dte')
  const [customSelectedExpiries, setCustomSelectedExpiries] = useState<string[]>([])

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

  // Get stable mocked stats for watchlist rendering
  const getWatchlistItem = useCallback((t: string) => {
    if (t === ticker && spotPrice !== null) {
      const charSum = t.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0)
      const isNeg = charSum % 2 === 0
      const pct = 0.2 + ((charSum % 220) / 100) * (isNeg ? -1 : 1)
      return { price: spotPrice, pct }
    }
    const charSum = t.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0)
    const isNeg = charSum % 2 === 0
    const pct = 0.2 + ((charSum % 220) / 100) * (isNeg ? -1 : 1)
    const basePrice = t === 'SPX' ? 7584.43 : t === 'SPY' ? 757.06 : t === 'QQQ' ? 740.50 : 180 + (charSum % 300)
    return { price: basePrice, pct }
  }, [ticker, spotPrice])

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
      const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
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

  // Filter option chain contracts based on selected active expiries (0dte, 90d, or custom)
  const activeOptionData = useMemo(() => {
    if (activeExpiries.length === 0) return optionData
    return optionData.filter(o => activeOptionDataMatches(o.expiration, activeExpiries))
  }, [optionData, activeExpiries])

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

  // Playback/Session timer states
  const [currentTimestamp, setCurrentTimestamp] = useState<string | null>(null)
  const [isLive, setIsLive] = useState(true)
  const [allTimestamps, setAllTimestamps] = useState<string[]>([])

  const fetchDashboardData = useCallback(async (
    selectedTicker: string,
    targetMarket?: Market,
    timestamp: string | null = null,
    isSilent: boolean = false
  ) => {
    try {
      if (!isSilent) {
        setIsLoading(true)
      }
      setError(null)
      const mkt = targetMarket || market

      let snapshot = null;
      
      // Try fetching from the database first
      try {
        const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001').replace(/\/+$/, '')
        let url = `${BACKEND_URL}/api/current-data?ticker=${selectedTicker.toUpperCase()}`
        if (timestamp) {
          url = `${BACKEND_URL}/api/historical-data?ticker=${selectedTicker.toUpperCase()}&timestamp=${encodeURIComponent(timestamp)}`
        }

        const response = await fetch(url)
        
        if (response.ok) {
          const json = await response.json()
          if (timestamp) {
            snapshot = json.data && json.data.length > 0 ? json.data[0] : null
          } else {
            snapshot = json.data
          }
        } else {
          console.warn(`Backend returned non-OK status: ${response.status} ${response.statusText}`);
        }
      } catch (backendError) {
        console.warn("Backend data pipeline unreachable, falling back to frontend direct options fetch:", backendError);
      }

      // Fallback to live frontend data fetch if no DB snapshot yet or backend failed
      if (!snapshot) {
        console.log(`No backend snapshot found for ${selectedTicker}. Falling back to live frontend fetch...`)
        const { spotPrice: sp, optionData: od } = await dataService.fetchOptionData(
          selectedTicker.toUpperCase(),
          mkt,
          pricingMethod
        )
        
        setTicker(selectedTicker.toUpperCase())
        setSpotPrice(sp)
        setOptionData(od)
        setTotalGEX(computeTotalGEX(sp, od, pricingMethod))
        setLastUpdated(new Date())
        setIsLive(true)
        setCurrentTimestamp(null)
        
        // Auto-setup defaults
        const today = new Date()
        const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
        const expiries = Array.from(new Set(
          od.map((o) => {
            const y = o.expiration.getUTCFullYear()
            const m = String(o.expiration.getUTCMonth() + 1).padStart(2, '0')
            const d = String(o.expiration.getUTCDate()).padStart(2, '0')
            return { expStr: `${y}-${m}-${d}`, time: o.expiration.getTime() }
          })
          .filter((item) => item.time >= todayUTC)
          .map((item) => item.expStr)
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
      const mappedOptions: OptionData[] = snapshot.options.map((opt: any) => ({
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

      setTicker(selectedTicker.toUpperCase())
      setSpotPrice(snapshot.spotPrice)
      setOptionData(mappedOptions)
      setTotalGEX(computeTotalGEX(snapshot.spotPrice, mappedOptions, pricingMethod))
      setLastUpdated(new Date(snapshot.timestamp))
      
      if (!timestamp) {
        setCurrentTimestamp(snapshot.timestamp)
      }

      // Update expiry defaults (completely timezone-independent UTC-matching calendar check)
      const today = new Date()
      const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())

      const expiries = Array.from(new Set(
        mappedOptions.map((o) => {
          const y = o.expiration.getUTCFullYear()
          const m = String(o.expiration.getUTCMonth() + 1).padStart(2, '0')
          const d = String(o.expiration.getUTCDate()).padStart(2, '0')
          return { expStr: `${y}-${m}-${d}`, time: o.expiration.getTime() }
        })
        .filter((item) => item.time >= todayUTC)
        .map((item) => item.expStr)
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

  const handleCheckpointChange = useCallback((ts: string | null, isCheckpointLive: boolean) => {
    setCurrentTimestamp(ts)
    setIsLive(isCheckpointLive)
    if (ts) {
      fetchDashboardData(ticker, undefined, ts, true)
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
    fetchDashboardData(ticker, undefined, isLive ? null : currentTimestamp, false)
  }

  const handlePricingMethodChange = (newMethod: PricingMethod) => {
    setPricingMethod(newMethod)
  }

  // Refetch when pricing method changes
  useEffect(() => {
    if (ticker) {
      fetchDashboardData(ticker, undefined, isLive ? null : currentTimestamp, true)
    }
  }, [pricingMethod])

  // Load initial data
  useEffect(() => {
    fetchDashboardData(market === 'USA' ? 'SPX' : 'NIFTY', undefined, null, false)
  }, [])

  return (
    <div className="min-h-screen bg-black flex flex-col md:flex-row">
      {/* ─── LEFT ICON NAVIGATION SIDEBAR (DESKTOP) ─── */}
      <aside className="hidden md:flex w-16 bg-[#08080A] border-r border-[#15151A] flex-col items-center py-4 flex-shrink-0 justify-between select-none">
        <div className="flex flex-col items-center gap-6 w-full">
          {SIDEBAR_TABS.map(tab => {
            const active = activeSidebarTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveSidebarTab(tab.id)
                  if (tab.id === 'gex') setActiveTab('gex-levels')
                }}
                className="group flex flex-col items-center gap-1.5 w-full relative transition-all"
                title={tab.label}
              >
                {/* Active green indicator tag */}
                {active && (
                  <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-terminal-green rounded-r" />
                )}

                {/* Tab Icon */}
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-all ${
                  active
                    ? 'bg-terminal-green/5 border-terminal-green/35 text-terminal-green'
                    : 'bg-transparent border-transparent text-[#444] group-hover:text-[#888]'
                }`}>
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
                </div>

                {/* Tab Label */}
                <span className={`text-[9px] font-mono leading-none tracking-tight ${
                  active ? 'text-[#E5E5E5]' : 'text-[#444]'
                }`}>
                  {tab.label.split(' ')[0]}
                </span>
              </button>
            )
          })}
        </div>

        {/* Footer info/settings placeholder */}
        <div className="w-6 h-6 rounded-full bg-[#111] border border-[#222] flex items-center justify-center cursor-pointer hover:border-[#444] transition-colors">
          <span className="text-[9px] font-mono text-[#949494]">V</span>
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
                if (tab.id === 'gex') setActiveTab('gex-levels')
              }}
              className="flex flex-col items-center justify-center gap-1 w-12"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-all ${
                active
                  ? 'bg-terminal-green/5 border-terminal-green/35 text-terminal-green'
                  : 'bg-transparent border-transparent text-[#949494]'
              }`}>
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
              </div>
              <span className={`text-[8px] font-mono leading-none tracking-tight ${
                active ? 'text-[#E5E5E5]' : 'text-[#949494]'
              }`}>
                {tab.label.split(' ')[0]}
              </span>
            </button>
          )
        })}
      </nav>

      {/* ─── MAIN WORKSPACE AND CONTENT GRID ─── */}
      <main className="flex-1 flex flex-col min-w-0 pb-16 md:pb-0">
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
          />
        )}

        {activeSidebarTab === 'gex' && activeTab === 'gex-levels' && hasData && !isLoading && (
          <div className="px-4 py-2 bg-[#020203] border-b border-[#1A1A1E] flex-shrink-0">
            <SessionTimer
              ticker={ticker}
              currentTimestamp={currentTimestamp}
              onCheckpointChange={handleCheckpointChange}
              isLive={isLive}
              onLiveChange={setIsLive}
              onTimestampsLoad={setAllTimestamps}
            />
          </div>
        )}



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

            {/* Interactive Sidebar mockups */}
            {activeSidebarTab !== 'gex' && activeSidebarTab !== 'journal' && activeSidebarTab !== 'flow' && (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-[#949494]">
                <div className="w-12 h-12 rounded-full border border-[#1A1A1E] bg-[#0A0A0C] flex items-center justify-center">
                  <svg className="w-5 h-5 text-[#333]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <div className="text-center">
                  <h3 className="text-xs font-bold font-mono text-[#E5E5E5] uppercase tracking-wider">{activeSidebarTab} SYSTEM LOCK</h3>
                  <p className="text-[10px] font-mono text-[#444] mt-1">PENDING REALTIME WEBSOCKET INGESTION PIPELINE</p>
                </div>
              </div>
            )}

            {/* Options Flow Workspace */}
            {activeSidebarTab === 'flow' && (
              <div className="flex-1 p-4 flex flex-col min-h-0 bg-[#020203]">
                <OptionFlowDashboard 
                  ticker={ticker}
                  onTickerSelect={handleTickerSelect}
                  availableTickers={watchlistTickers}
                />
              </div>
            )}

            {/* Trading Journal Workspace */}
            {activeSidebarTab === 'journal' && (
              <TradingJournal />
            )}

            {/* Active GEX Workspace tabs content */}
            {activeSidebarTab === 'gex' && hasData && !isLoading && (
              <div className="flex-1 flex flex-col min-h-0">
                {/* TOP WORKSPACE NAVIGATION TABS (Moved from bottom) */}
                <div className="border-b border-[#1A1A1E] bg-[#08080A] flex items-center px-4 py-2 justify-between select-none flex-shrink-0">
                  <div className="flex items-center gap-1.5">
                    {BOTTOM_TABS.map(tab => {
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

                  {/* Settings toggle */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-[#444] uppercase">Engine</span>
                    <Select value={pricingMethod} onValueChange={(v) => handlePricingMethodChange(v as PricingMethod)}>
                      <SelectTrigger className="w-28 h-6 text-[10px] bg-black border-[#1A1A1E]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-black border-[#1A1A1E]">
                        <SelectItem value="black-scholes">Black-Scholes</SelectItem>
                        <SelectItem value="simplified">Constant IV</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Workspace tab views with loading screen overlay */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 terminal-scrollbar relative">
                  {isUpdating && (
                    <div className="absolute inset-0 bg-black/85 backdrop-blur-sm z-50 flex flex-col items-center justify-center transition-all duration-300">
                      <div className="flex items-center gap-3 text-terminal-green">
                        <div className="w-4 h-4 border-2 border-transparent border-t-terminal-green rounded-full animate-spin" />
                        <span className="text-xs font-mono tracking-widest uppercase">UPDATING TERMINAL SNAPSHOT...</span>
                      </div>
                    </div>
                  )}

                  {/* 1. GEX Levels Workspace (Synced Candlestick + GEX + Volume + Chain) */}
                  {activeTab === 'gex-levels' && (
                    <div className="flex flex-col gap-4">
                      {/* Synced Workspace Chart Card */}
                      <div className="bg-[#0A0A0C] border border-[#1A1A1E] rounded-lg p-3">
                        {/* Chart View */}
                        <div className="h-[1200px]">
                          <SyncedStrikeWorkspace
                            optionData={activeOptionData}
                            ticker={ticker}
                            spotPrice={spotPrice!}
                            market={market}
                            pricingMethod={pricingMethod}
                            expiryMode={expiryMode}
                          />
                        </div>
                      </div>

                      {/* Option Chain Card below */}
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
                                  <SelectItem value="ALL">ALL</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-[#949494] font-mono uppercase">Expiry</span>
                              <Select value={selectedRampExpiry} onValueChange={setSelectedRampExpiry}>
                                <SelectTrigger className="w-28 h-6 text-[10px] bg-black border-[#1A1A1E]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-black border-[#1A1A1E]">
                                  {futureExpiries.map((exp) => (
                                    <SelectItem key={exp} value={exp}>{exp.slice(5)}</SelectItem>
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
                    </div>
                  )}

                  {/* 2. Flow/Historical Workspace */}
                  {activeTab === 'flow-historical' && (
                    <div className="flex-1 p-4 overflow-y-auto">
                      <FlowHistoricalView
                        ticker={ticker}
                        currentTimestamp={currentTimestamp}
                        onCheckpointChange={handleCheckpointChange}
                        isLive={isLive}
                        setIsLive={setIsLive}
                        parentLoading={isLoading}
                      />
                    </div>
                  )}

                  {/* 3. Data Graph Workspace */}
                  {activeTab === 'data-graph' && (
                    <ChartWrapper
                      title="GEX Expiration Data Graph"
                      subtitle="Aggregate distribution of Net and Total Gamma across expiration cycles"
                      height="900px"
                    >
                      <GEXDataGraphDashboard data={optionData} />
                    </ChartWrapper>
                  )}

                  {/* 4. 3D Surface Model Workspace */}
                  {activeTab === 'surface' && (
                    <ChartWrapper
                      title="3D Gamma Exposure Surface"
                      subtitle="Interactive 3D visualization mapping strike price and expiration date curves"
                      height="1000px"
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
                  )}

                  {/* 5. Expected Move Workspace */}
                  {activeTab === 'expected-move' && (
                    <ChartWrapper
                      title="Implied Expected Move Ranges"
                      subtitle="Implied boundaries calculated via 16-delta strangle options method"
                      height="900px"
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
                  )}

                  {/* 6. Greek Gradient Heatmaps Workspace */}
                  {activeTab === 'gradient-charts' && (
                    <div className="h-[1200px] w-full">
                      <GradientChartsWorkspace
                        optionData={activeOptionData}
                        ticker={ticker}
                        spotPrice={spotPrice!}
                        market={market}
                        pricingMethod={pricingMethod}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ─── RIGHT SIDEBAR PANEL: WATCHLIST & EXPRIS SELECTOR ─── */}
          {activeSidebarTab === 'gex' && hasData && !isLoading && (
            <aside className="w-[270px] bg-[#08080A] border-l border-[#1A1A1E] flex flex-col gap-4 p-3 flex-shrink-0 select-none overflow-y-auto terminal-scrollbar h-full">
              {/* Watchlist Section */}
              <div className="border border-[#1A1A1E] bg-[#0A0A0C] rounded-lg p-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between border-b border-[#1A1A1E] pb-2">
                  <span className="text-[11px] font-mono font-bold text-[#E5E5E5]">WATCHLIST</span>
                  {/* Add ticker form */}
                  <form onSubmit={handleAddTickerSubmit} className="flex items-center gap-1.5">
                    <input
                      name="tickerSearch"
                      type="text"
                      placeholder="ADD..."
                      className="w-12 h-5 text-[9px] font-mono bg-black border border-[#222] rounded px-1 text-white outline-none focus:border-terminal-green/40"
                    />
                    <button
                      type="submit"
                      className="w-5 h-5 flex items-center justify-center rounded border border-[#222] bg-black/40 text-[10px] text-[#949494] hover:text-[#888] hover:border-[#333]"
                    >
                      +
                    </button>
                  </form>
                </div>

                {/* Watchlist list */}
                <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-0.5 terminal-scrollbar">
                  {watchlistTickers.map(t => {
                    const active = t === ticker
                    const stats = getWatchlistItem(t)
                    const isUp = stats.pct >= 0

                    return (
                      <div
                        key={t}
                        onClick={() => handleTickerSelect(t)}
                        className={`flex items-center justify-between px-2 py-1 rounded transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#15151A] text-[#E5E5E5] border border-terminal-green/30'
                            : 'text-[#666] hover:bg-[#0E0E10] hover:text-[#888] border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold uppercase">
                            {t}
                          </span>
                          {customTickers.includes(t) && (
                            <button
                              type="button"
                              onClick={(e) => handleRemoveCustomTicker(t, e)}
                              className="text-[9px] text-terminal-red/60 hover:text-terminal-red font-bold"
                            >
                              ×
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono font-bold">
                            {stats.price.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                          </span>
                          <span className={`text-[9px] font-mono px-1 rounded text-center min-w-[42px] font-bold ${
                            isUp
                              ? 'bg-terminal-green/10 text-terminal-green'
                              : 'bg-terminal-red/10 text-terminal-red'
                          }`}>
                            {isUp ? '+' : ''}{stats.pct.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Expiries Selector Card */}
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[11px] font-mono font-bold text-[#E5E5E5]">EXPIRATIONS</span>
                  </div>
                  <ExpirySelector
                    availableExpiries={futureExpiries}
                    mode={expiryMode}
                    onModeChange={setExpiryMode}
                    selectedExpiries={customSelectedExpiries}
                    onSelectedExpiriesChange={setCustomSelectedExpiries}
                    optionData={optionData}
                  />
                </div>
              </div>
            </aside>
          )}
        </div>
      </main>
    </div>
  )
}
