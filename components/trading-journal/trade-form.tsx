"use client"

import React, { useState, useEffect, useRef } from "react"
import { JournalTrade } from "./types"
import { compressImage } from "./image-utils"
import { Upload, X, AlertTriangle } from "lucide-react"

interface TradeFormProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (trade: JournalTrade) => void
  initialTrade?: JournalTrade | null
}

const STRATEGIES = [
  "Hurst Regime HMA/EMA",
  "Zero Gamma Bounce",
  "GEX Flip Breakout",
  "Call Wall Resistance",
  "Put Wall Support",
  "Expected Move Edge",
  "EMA Cross Trend",
  "VIX Volatility Expansion",
  "Opening Range Breakout",
  "Custom/Other"
]

export function TradeForm({ isOpen, onClose, onSubmit, initialTrade }: TradeFormProps) {
  const [ticker, setTicker] = useState("")
  const [tradeDate, setTradeDate] = useState("")
  const [timeEntered, setTimeEntered] = useState("")
  const [timeExited, setTimeExited] = useState("")
  const [tradeType, setTradeType] = useState<"Equity" | "Option">("Option")
  const isFeesManualRef = useRef(false)
  
  // Option specific state
  const [strike, setStrike] = useState("")
  const [optionType, setOptionType] = useState<"C" | "P">("C")
  const [expiration, setExpiration] = useState("")

  const [direction, setDirection] = useState<"Buy" | "Sell">("Buy")
  const [quality, setQuality] = useState<"S" | "A" | "B">("A")
  const [status, setStatus] = useState<"Open" | "Closed">("Closed")
  
  const [pnl, setPnl] = useState("")
  const [pnlPercent, setPnlPercent] = useState("")
  const [rationale, setRationale] = useState("")
  const [strategy, setStrategy] = useState(STRATEGIES[0])
  const [quantity, setQuantity] = useState("")
  const [entryPrice, setEntryPrice] = useState("")
  const [exitPrice, setExitPrice] = useState("")
  const [currentPrice, setCurrentPrice] = useState("")
  const [fees, setFees] = useState("0")

  // Screenshot upload states
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [isCompressing, setIsCompressing] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  // Initialize fields on mount or when editing trade loads
  useEffect(() => {
    if (initialTrade) {
      setTicker(initialTrade.ticker)
      setTradeDate(initialTrade.tradeDate)
      setTimeEntered(initialTrade.timeEntered || "")
      setTimeExited(initialTrade.timeExited || "")
      setTradeType(initialTrade.tradeType)
      setStrike(initialTrade.strike ? initialTrade.strike.toString() : "")
      setOptionType(initialTrade.optionType || "C")
      setExpiration(initialTrade.expiration || "")
      setDirection(initialTrade.direction)
      setQuality(initialTrade.quality)
      setStatus(initialTrade.status || "Closed")
      setPnl(initialTrade.pnl.toString())
      setPnlPercent(initialTrade.pnlPercent.toString())
      setRationale(initialTrade.rationale || "")
      setStrategy(initialTrade.strategy || STRATEGIES[0])
      setQuantity(initialTrade.quantity.toString())
      setEntryPrice(initialTrade.entryPrice.toString())
      
      if (initialTrade.status === "Open") {
        setCurrentPrice(initialTrade.exitPrice.toString())
        setExitPrice("")
      } else {
        setExitPrice(initialTrade.exitPrice.toString())
        setCurrentPrice("")
      }
      
      setFees(initialTrade.fees ? initialTrade.fees.toString() : "0")
      setScreenshot(initialTrade.screenshot || null)
    } else {
      // Default to today
      const today = new Date().toISOString().split("T")[0]
      setTradeDate(today)
      setTicker("")
      setTimeEntered("")
      setTimeExited("")
      setTradeType("Option")
      setStrike("")
      setOptionType("C")
      setExpiration(today)
      setDirection("Buy")
      setQuality("A")
      setStatus("Closed")
      setPnl("")
      setPnlPercent("")
      setRationale("")
      setStrategy(STRATEGIES[0])
      setQuantity("")
      setEntryPrice("")
      setExitPrice("")
      setCurrentPrice("")
      setFees("0")
      isFeesManualRef.current = false
      setScreenshot(null)
    }
    setUploadError(null)
  }, [initialTrade, isOpen])

  // Auto-calculate fees ($1.2 per 100 quantity) if not overridden manually
  useEffect(() => {
    if (initialTrade || isFeesManualRef.current) return
    const qtyVal = parseFloat(quantity)
    if (!isNaN(qtyVal)) {
      const calcFees = (qtyVal / 100) * 1.2
      setFees(calcFees.toFixed(2))
    } else {
      setFees("0")
    }
  }, [quantity, initialTrade])

  // Automatically calculate PnL and PnL% when variables change
  useEffect(() => {
    if (initialTrade) return // Don't overwrite edited PnLs during load
    
    const qtyVal = parseFloat(quantity)
    const entryVal = parseFloat(entryPrice)
    const targetPriceVal = status === "Open" ? parseFloat(currentPrice) : parseFloat(exitPrice)
    const feesVal = parseFloat(fees) || 0

    if (!isNaN(qtyVal) && !isNaN(entryVal) && !isNaN(targetPriceVal) && qtyVal > 0 && entryVal > 0) {
      let calcPnl = 0
      if (direction === "Buy") {
        // Buy low, Sell high
        calcPnl = (targetPriceVal - entryVal) * qtyVal - feesVal
      } else {
        // Sell high, Buy low (Short)
        calcPnl = (entryVal - targetPriceVal) * qtyVal - feesVal
      }
      
      const calcPnlPct = (calcPnl / (entryVal * qtyVal)) * 100

      setPnl(calcPnl.toFixed(2))
      setPnlPercent(calcPnlPct.toFixed(2))
    }
  }, [quantity, entryPrice, exitPrice, currentPrice, fees, direction, status, initialTrade])

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await processImageFile(e.dataTransfer.files[0])
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await processImageFile(e.target.files[0])
    }
  }

  const processImageFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setUploadError("Uploaded file must be an image")
      return
    }

    try {
      setIsCompressing(true)
      setUploadError(null)
      const compressedBase64 = await compressImage(file, 800, 0.7)
      setScreenshot(compressedBase64)
    } catch (err) {
      console.error(err)
      setUploadError("Image compression failed. Try a smaller file.")
    } finally {
      setIsCompressing(false)
    }
  }

  const handleRemoveScreenshot = (e: React.MouseEvent) => {
    e.stopPropagation()
    setScreenshot(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!ticker.trim()) return
    if (!tradeDate) return
    if (isNaN(parseFloat(pnl)) || isNaN(parseFloat(pnlPercent))) return

    const actualExitPrice = status === "Open" ? (parseFloat(currentPrice) || 0) : (parseFloat(exitPrice) || 0)

    const trade: JournalTrade = {
      id: initialTrade?.id || `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      tradeDate,
      timeEntered: timeEntered || null,
      timeExited: timeExited || null,
      ticker: ticker.trim().toUpperCase(),
      tradeType,
      strike: tradeType === "Option" && strike ? parseFloat(strike) : null,
      optionType: tradeType === "Option" ? optionType : null,
      expiration: tradeType === "Option" && expiration ? expiration : null,
      direction,
      quality,
      status,
      pnl: parseFloat(pnl),
      pnlPercent: parseFloat(pnlPercent),
      screenshot,
      rationale: rationale.trim() || null,
      strategy: strategy || null,
      quantity: parseFloat(quantity) || 0,
      entryPrice: parseFloat(entryPrice) || 0,
      exitPrice: actualExitPrice,
      fees: parseFloat(fees) || 0
    }

    onSubmit(trade)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#0A0A0C] border border-[#1A1A1E] text-[#E5E5E5] w-full max-w-2xl rounded-lg shadow-2xl relative my-8 flex flex-col max-h-[90vh] font-mono">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1A1A1E] px-5 py-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-terminal-green animate-pulse" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">
              {initialTrade ? "Modify Position Snapshot" : "Log New Position"}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#888] hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {/* Main Info Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Ticker */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[#D4D4D4] text-[10px] uppercase font-bold">Ticker</label>
              <input
                required
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="SPY"
                className="bg-black border border-[#1A1A1E] text-white px-3 py-1.5 rounded outline-none focus:border-terminal-green/45"
              />
            </div>

            {/* Date */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[#D4D4D4] text-[10px] uppercase font-bold">Trade Date</label>
              <input
                required
                type="date"
                value={tradeDate}
                onChange={(e) => setTradeDate(e.target.value)}
                className="bg-black border border-[#1A1A1E] text-white px-3 py-1.5 rounded outline-none focus:border-terminal-green/45"
              />
            </div>

            {/* Time Entered */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[#D4D4D4] text-[10px] uppercase font-bold">Time Entered</label>
              <input
                type="time"
                value={timeEntered}
                onChange={(e) => setTimeEntered(e.target.value)}
                className="bg-black border border-[#1A1A1E] text-white px-3 py-1.5 rounded outline-none focus:border-terminal-green/45"
              />
            </div>

            {/* Time Exited */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[#D4D4D4] text-[10px] uppercase font-bold">Time Exited</label>
              <input
                type="time"
                value={timeExited}
                onChange={(e) => setTimeExited(e.target.value)}
                className="bg-black border border-[#1A1A1E] text-white px-3 py-1.5 rounded outline-none focus:border-terminal-green/45"
              />
            </div>
          </div>

          {/* Config row (Direction, Type, Quality, Status) */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 border-t border-[#1A1A1E] pt-4">
            {/* Direction Select */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[#D4D4D4] text-[10px] uppercase font-bold">Direction</label>
              <div className="grid grid-cols-2 gap-1 bg-black p-0.5 rounded border border-[#1A1A1E]">
                <button
                  type="button"
                  onClick={() => setDirection("Buy")}
                  className={`py-1 rounded text-[10px] transition-all ${
                    direction === "Buy"
                      ? "bg-terminal-green/10 text-terminal-green font-bold border border-terminal-green/20"
                      : "text-[#A3A3A3] border border-transparent hover:text-white"
                  }`}
                >
                  BUY
                </button>
                <button
                  type="button"
                  onClick={() => setDirection("Sell")}
                  className={`py-1 rounded text-[10px] transition-all ${
                    direction === "Sell"
                      ? "bg-terminal-red/10 text-terminal-red font-bold border border-terminal-red/20"
                      : "text-[#A3A3A3] border border-transparent hover:text-white"
                  }`}
                >
                  SELL
                </button>
              </div>
            </div>

            {/* Type Select */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[#D4D4D4] text-[10px] uppercase font-bold">Asset Type</label>
              <div className="grid grid-cols-2 gap-1 bg-black p-0.5 rounded border border-[#1A1A1E]">
                <button
                  type="button"
                  onClick={() => setTradeType("Equity")}
                  className={`py-1 rounded text-[10px] transition-all ${
                    tradeType === "Equity"
                      ? "bg-[#15151A] text-white font-bold border border-[#25252E]"
                      : "text-[#A3A3A3] border border-transparent hover:text-white"
                  }`}
                >
                  EQUITY
                </button>
                <button
                  type="button"
                  onClick={() => setTradeType("Option")}
                  className={`py-1 rounded text-[10px] transition-all ${
                    tradeType === "Option"
                      ? "bg-[#15151A] text-white font-bold border border-[#25252E]"
                      : "text-[#A3A3A3] border border-transparent hover:text-white"
                  }`}
                >
                  OPTION
                </button>
              </div>
            </div>

            {/* Quality Select */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[#D4D4D4] text-[10px] uppercase font-bold">Trade Quality</label>
              <div className="grid grid-cols-3 gap-1 bg-black p-0.5 rounded border border-[#1A1A1E]">
                <button
                  type="button"
                  onClick={() => setQuality("S")}
                  className={`py-1 rounded text-[10px] transition-all font-bold ${
                    quality === "S"
                      ? "bg-terminal-amber/15 text-terminal-amber border border-terminal-amber/30"
                      : "text-[#A3A3A3] border border-transparent hover:text-white"
                  }`}
                >
                  S
                </button>
                <button
                  type="button"
                  onClick={() => setQuality("A")}
                  className={`py-1 rounded text-[10px] transition-all font-bold ${
                    quality === "A"
                      ? "bg-terminal-green/15 text-terminal-green border border-terminal-green/30"
                      : "text-[#A3A3A3] border border-transparent hover:text-white"
                  }`}
                >
                  A
                </button>
                <button
                  type="button"
                  onClick={() => setQuality("B")}
                  className={`py-1 rounded text-[10px] transition-all font-bold ${
                    quality === "B"
                      ? "bg-terminal-purple/15 text-terminal-purple border border-terminal-purple/30"
                      : "text-[#A3A3A3] border border-transparent hover:text-white"
                  }`}
                >
                  B
                </button>
              </div>
            </div>

            {/* Status Select */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[#D4D4D4] text-[10px] uppercase font-bold">Position Status</label>
              <div className="grid grid-cols-2 gap-1 bg-black p-0.5 rounded border border-[#1A1A1E]">
                <button
                  type="button"
                  onClick={() => {
                    setStatus("Open")
                    setExitPrice("")
                  }}
                  className={`py-1 rounded text-[10px] transition-all font-bold ${
                    status === "Open"
                      ? "bg-terminal-green/10 text-terminal-green border border-terminal-green/20"
                      : "text-[#A3A3A3] border border-transparent hover:text-white"
                  }`}
                >
                  OPEN
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStatus("Closed")
                    setCurrentPrice("")
                  }}
                  className={`py-1 rounded text-[10px] transition-all font-bold ${
                    status === "Closed"
                      ? "bg-[#15151A] text-white border border-[#25252E]"
                      : "text-[#A3A3A3] border border-transparent hover:text-white"
                  }`}
                >
                  CLOSED
                </button>
              </div>
            </div>
          </div>

          {/* Option Contract Inputs */}
          {tradeType === "Option" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-[#0A0A0C] border border-[#15151C] rounded p-3 text-xs font-mono animate-fade-in">
              {/* Strike Price */}
              <div className="flex flex-col gap-1">
                <label className="text-[#D4D4D4] text-[9px] uppercase font-bold">Strike Price</label>
                <input
                  required={tradeType === "Option"}
                  type="number"
                  step="any"
                  value={strike}
                  onChange={(e) => setStrike(e.target.value)}
                  placeholder="e.g. 500"
                  className="bg-black border border-[#1A1A1E] text-white px-2.5 py-1 rounded outline-none focus:border-terminal-green/45"
                />
              </div>

              {/* Option Type (C/P) */}
              <div className="flex flex-col gap-1">
                <label className="text-[#D4D4D4] text-[9px] uppercase font-bold">Call / Put</label>
                <div className="grid grid-cols-2 gap-1 bg-black p-0.5 rounded border border-[#1A1A1E] h-[26px]">
                  <button
                    type="button"
                    onClick={() => setOptionType("C")}
                    className={`rounded text-[10px] font-bold ${
                      optionType === "C" ? "bg-[#1C2C22] text-terminal-green border border-terminal-green/10" : "text-[#A3A3A3]"
                    }`}
                  >
                    CALL
                  </button>
                  <button
                    type="button"
                    onClick={() => setOptionType("P")}
                    className={`rounded text-[10px] font-bold ${
                      optionType === "P" ? "bg-[#2D1F23] text-terminal-red border border-terminal-red/10" : "text-[#A3A3A3]"
                    }`}
                  >
                    PUT
                  </button>
                </div>
              </div>

              {/* Option Expiration */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-[#D4D4D4] text-[9px] uppercase font-bold">Contract Expiry</label>
                  <button
                    type="button"
                    onClick={() => {
                      const today = new Date().toISOString().split("T")[0]
                      setTradeDate(today)
                      setExpiration(today)
                    }}
                    className="text-[8px] bg-terminal-green/10 text-terminal-green border border-terminal-green/20 px-1.5 py-0.5 rounded hover:bg-terminal-green hover:text-black font-bold uppercase transition-all"
                  >
                    0DTE
                  </button>
                </div>
                <input
                  required={tradeType === "Option"}
                  type="date"
                  value={expiration}
                  onChange={(e) => setExpiration(e.target.value)}
                  className="bg-black border border-[#1A1A1E] text-white px-2.5 py-1 rounded outline-none w-full focus:border-terminal-green/45"
                />
              </div>
            </div>
          )}

          {/* Pricing parameters & sizing */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-[#1A1A1E] pt-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[#D4D4D4] text-[10px] uppercase font-bold">Quantity / Size</label>
              <input
                required
                type="number"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="100"
                className="bg-black border border-[#1A1A1E] text-white px-3 py-1.5 rounded outline-none focus:border-terminal-green/45"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[#D4D4D4] text-[10px] uppercase font-bold">Entry Price ($)</label>
              <input
                required
                type="number"
                step="any"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                placeholder="150.50"
                className="bg-black border border-[#1A1A1E] text-white px-3 py-1.5 rounded outline-none focus:border-terminal-green/45"
              />
            </div>

            {/* Exit vs Current Price dependent on Status */}
            {status === "Open" ? (
              <div className="flex flex-col gap-1.5">
                <label className="text-[#D4D4D4] text-[10px] uppercase font-bold">Current Price ($)</label>
                <input
                  required
                  type="number"
                  step="any"
                  value={currentPrice}
                  onChange={(e) => setCurrentPrice(e.target.value)}
                  placeholder="153.20"
                  className="bg-black border border-[#1A1A1E] text-white px-3 py-1.5 rounded outline-none focus:border-terminal-green/45"
                />
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label className="text-[#D4D4D4] text-[10px] uppercase font-bold">Exit Price ($)</label>
                <input
                  required
                  type="number"
                  step="any"
                  value={exitPrice}
                  onChange={(e) => setExitPrice(e.target.value)}
                  placeholder="153.20"
                  className="bg-black border border-[#1A1A1E] text-white px-3 py-1.5 rounded outline-none focus:border-terminal-green/45"
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-[#D4D4D4] text-[10px] uppercase font-bold">Fees ($)</label>
              <input
                type="number"
                step="any"
                value={fees}
                onChange={(e) => {
                  isFeesManualRef.current = true
                  setFees(e.target.value)
                }}
                className="bg-black border border-[#1A1A1E] text-white px-3 py-1.5 rounded outline-none focus:border-terminal-green/45"
              />
            </div>
          </div>

          {/* Setup / Strategy & Manual Overrides of PnL */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-[#1A1A1E] pt-4">
            {/* Strategy Select */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[#D4D4D4] text-[10px] uppercase font-bold">Setup / Strategy</label>
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                className="bg-black border border-[#1A1A1E] text-white px-3 py-1.5 rounded h-[29px] outline-none cursor-pointer focus:border-terminal-green/45"
              >
                {STRATEGIES.map((strat) => (
                  <option key={strat} value={strat} className="bg-black text-white">{strat}</option>
                ))}
              </select>
            </div>

            {/* PnL override */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[#D4D4D4] text-[10px] uppercase font-bold">Net PnL ($)</label>
              <input
                required
                type="number"
                step="any"
                value={pnl}
                onChange={(e) => setPnl(e.target.value)}
                placeholder="Calculated automatically..."
                className="bg-black border border-[#1A1A1E] font-bold px-3 py-1.5 rounded outline-none focus:border-terminal-green/45 text-terminal-green"
                style={{
                  color: parseFloat(pnl) < 0 ? "#FF3B60" : parseFloat(pnl) > 0 ? "#00C805" : "#E5E5E5"
                }}
              />
            </div>

            {/* PnL % override */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[#D4D4D4] text-[10px] uppercase font-bold">Return Percentage (%)</label>
              <input
                required
                type="number"
                step="any"
                value={pnlPercent}
                onChange={(e) => setPnlPercent(e.target.value)}
                placeholder="Calculated automatically..."
                className="bg-black border border-[#1A1A1E] font-bold px-3 py-1.5 rounded outline-none focus:border-terminal-green/45 text-terminal-green"
                style={{
                  color: parseFloat(pnlPercent) < 0 ? "#FF3B60" : parseFloat(pnlPercent) > 0 ? "#00C805" : "#E5E5E5"
                }}
              />
            </div>
          </div>

          {/* Screenshot Uploader */}
          <div className="flex flex-col gap-1.5 border-t border-[#1A1A1E] pt-4">
            <label className="text-[#D4D4D4] text-[10px] uppercase font-bold">Chart Screenshot</label>
            
            {uploadError && (
              <div className="text-[10px] text-terminal-red bg-terminal-red/5 border border-terminal-red/25 px-3 py-2 rounded flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{uploadError}</span>
              </div>
            )}

            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border rounded-lg p-5 flex flex-col items-center justify-center cursor-pointer transition-all ${
                dragActive
                  ? "border-terminal-green bg-terminal-green/5"
                  : screenshot
                  ? "border-[#25252E] bg-black/40"
                  : "border-[#1A1A1E] hover:border-[#333] hover:bg-black/30"
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                className="hidden"
              />

              {isCompressing ? (
                <div className="flex flex-col items-center gap-2 text-terminal-green">
                  <div className="w-5 h-5 border-2 border-transparent border-t-terminal-green rounded-full animate-spin" />
                  <span className="text-[10px] uppercase tracking-wide">Optimizing Image (JPEG 70%)...</span>
                </div>
              ) : screenshot ? (
                <div className="relative group max-w-sm w-full border border-[#25252E] rounded overflow-hidden">
                  <img src={screenshot} alt="Screenshot preview" className="w-full h-32 object-cover" />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all">
                    <button
                      type="button"
                      onClick={handleRemoveScreenshot}
                      className="bg-terminal-red text-white p-1.5 rounded-full hover:scale-105 transition-all"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <span className="absolute bottom-1 right-1 bg-black/75 px-1.5 py-0.5 rounded text-[8px] text-[#A3A3A3]">
                    ~{(screenshot.length * 0.75 / 1024).toFixed(1)} KB
                  </span>
                </div>
              ) : (
                <div className="text-center space-y-1 text-[#949494] group hover:text-[#888]">
                  <Upload className="w-6 h-6 mx-auto mb-1 text-[#444] group-hover:text-[#666]" />
                  <p className="text-[10px] uppercase font-bold tracking-wider text-[#A3A3A3]">Drag & Drop Trading Chart Screenshot</p>
                  <p className="text-[9px] text-[#949494]">Or click to browse from files</p>
                </div>
              )}
            </div>
          </div>

          {/* Trade Rationale */}
          <div className="flex flex-col gap-1.5 border-t border-[#1A1A1E] pt-4">
            <label className="text-[#D4D4D4] text-[10px] uppercase font-bold">Trade Rationale & Execution Notes</label>
            <textarea
              rows={3}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Describe market indicators, why you took the trade, how you managed risk, and lesson learned..."
              className="bg-black border border-[#1A1A1E] text-white px-3 py-2 rounded outline-none focus:border-terminal-green/45 resize-none font-sans leading-relaxed"
            />
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-end gap-3 border-t border-[#1A1A1E] pt-5 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-transparent text-[#A3A3A3] hover:text-white transition-colors border border-transparent"
            >
              CANCEL
            </button>
            <button
              type="submit"
              disabled={isCompressing || !ticker.trim() || !tradeDate || isNaN(parseFloat(pnl))}
              className={`px-5 py-2 font-bold uppercase rounded border transition-all ${
                isCompressing || !ticker.trim() || !tradeDate || isNaN(parseFloat(pnl))
                  ? "bg-[#15151A] text-[#444] border-transparent cursor-not-allowed"
                  : "bg-terminal-green text-black hover:bg-terminal-green/90 border-terminal-green hover:shadow-lg"
              }`}
            >
              {initialTrade ? "UPDATE POSITION" : "COMMIT JOURNAL ENTRY"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
