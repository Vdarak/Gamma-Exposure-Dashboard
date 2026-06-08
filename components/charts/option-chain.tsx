"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import type { OptionData } from "@/lib/types"

interface OptionChainProps {
  data: OptionData[]
  ticker: string
  spotPrice: number
  selectedExpiry: string
  onExpiryChange: (expiry: string) => void
  availableExpiries: string[]
  strikesCount: number | "ALL"
  onStrikesCountChange: (count: number | "ALL") => void
}

interface ProcessedOption {
  strike: number
  call?: OptionData & { greeks: GreeksData }
  put?: OptionData & { greeks: GreeksData }
}

interface GreeksData {
  delta: number
  gamma: number
  theta: number
  vega: number
  rho: number
  iv: number
}

// Black-Scholes Greeks calculations
function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

function normalCDF(x: number): number {
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911

  const sign = x < 0 ? -1 : 1
  x = Math.abs(x) / Math.sqrt(2.0)

  const t = 1.0 / (1.0 + p * x)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)

  return 0.5 * (1.0 + sign * y)
}

function calculateGreeks(
  S: number, // Spot price
  K: number, // Strike
  T: number, // Time to expiration (years)
  r: number, // Risk-free rate
  vol: number, // Volatility
  isCall: boolean
): GreeksData {
  if (T <= 0 || vol <= 0 || S <= 0 || K <= 0) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, iv: vol }
  }

  const d1 = (Math.log(S / K) + (r + 0.5 * vol * vol) * T) / (vol * Math.sqrt(T))
  const d2 = d1 - vol * Math.sqrt(T)
  
  const Nd1 = normalCDF(d1)
  const Nd2 = normalCDF(d2)
  const nd1 = normalPDF(d1)

  // Delta
  const delta = isCall ? Nd1 : Nd1 - 1

  // Gamma (same for calls and puts)
  const gamma = nd1 / (S * vol * Math.sqrt(T))

  // Theta
  const term1 = -(S * nd1 * vol) / (2 * Math.sqrt(T))
  const term2 = isCall ? -r * K * Math.exp(-r * T) * Nd2 : r * K * Math.exp(-r * T) * normalCDF(-d2)
  const theta = (term1 + term2) / 365 // Convert to per day

  // Vega (same for calls and puts)
  const vega = (S * nd1 * Math.sqrt(T)) / 100 // Per 1% vol change

  // Rho
  const rho = isCall 
    ? (K * T * Math.exp(-r * T) * Nd2) / 100
    : (-K * T * Math.exp(-r * T) * normalCDF(-d2)) / 100

  return {
    delta: delta,
    gamma: gamma,
    theta: theta,
    vega: vega,
    rho: rho,
    iv: vol
  }
}

export function OptionChain({ 
  data, 
  ticker, 
  spotPrice, 
  selectedExpiry, 
  onExpiryChange, 
  availableExpiries,
  strikesCount,
  onStrikesCountChange 
}: OptionChainProps) {
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null)

  const processedData = useMemo(() => {
    const today = new Date()
    let filteredData = data

    // Filter by expiry (no "All Dates" option)
    const selectedDate = new Date(selectedExpiry)
    filteredData = data.filter((option) => 
      option.expiration.toDateString() === selectedDate.toDateString()
    )

    // Calculate time to expiration
    filteredData.forEach((option) => {
      const daysDiff = Math.max(1, Math.ceil((option.expiration.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)))
      option.daysTillExp = daysDiff === 0 ? 1 / 365 : daysDiff / 365
    })

    // Group by strike
    const strikeMap = new Map<number, ProcessedOption>()

    filteredData.forEach((option) => {
      const strike = option.strike
      const existing = strikeMap.get(strike) || { strike }
      
      const greeks = calculateGreeks(
        spotPrice,
        strike,
        option.daysTillExp!,
        0.05, // 5% risk-free rate
        option.iv,
        option.type === "C"
      )

      const optionWithGreeks = { ...option, greeks }

      if (option.type === "C") {
        existing.call = optionWithGreeks
      } else {
        existing.put = optionWithGreeks
      }

      strikeMap.set(strike, existing)
    })

    const allStrikes = Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike)
    
    if (strikesCount === "ALL") {
      return allStrikes
    }
    
    // Find closest at-the-money strike
    const atmIndex = allStrikes.findIndex(option => option.strike >= spotPrice)
    const startIndex = Math.max(0, atmIndex - strikesCount) // Show n strikes below ATM
    const endIndex = Math.min(allStrikes.length, atmIndex + strikesCount) // Show n strikes above ATM
    
    return allStrikes.slice(startIndex, endIndex)
  }, [data, selectedExpiry, spotPrice, strikesCount])

  const formatPercent = (value: number) => `${(value * 100).toFixed(2)}%`
  const formatPrice = (value: number) => `$${value.toFixed(2)}`
  const formatGreek = (value: number, decimals = 4) => value.toFixed(decimals)

  // Helper function to calculate Black-Scholes option price
  const calculateBlackScholesPrice = (
    S: number, // Spot price
    K: number, // Strike price
    T: number, // Time to expiration (years)
    r: number, // Risk-free rate
    vol: number, // Volatility
    isCall: boolean
  ): number => {
    if (T <= 0 || vol <= 0 || S <= 0 || K <= 0) {
      return 0
    }

    const d1 = (Math.log(S / K) + (r + 0.5 * vol * vol) * T) / (vol * Math.sqrt(T))
    const d2 = d1 - vol * Math.sqrt(T)
    
    const Nd1 = normalCDF(d1)
    const Nd2 = normalCDF(d2)
    const NnegD1 = normalCDF(-d1)
    const NnegD2 = normalCDF(-d2)

    if (isCall) {
      return S * Nd1 - K * Math.exp(-r * T) * Nd2
    } else {
      return K * Math.exp(-r * T) * NnegD2 - S * NnegD1
    }
  }

  // Helper function to get bid/ask prices
  const getBidPrice = (option: OptionData & { greeks: GreeksData }) => {
    if (option.bid && option.bid > 0) {
      return formatPrice(option.bid)
    }
    // Calculate theoretical price using Black-Scholes
    const theoreticalPrice = calculateBlackScholesPrice(
      spotPrice,
      option.strike,
      option.daysTillExp || 0.1,
      0.05, // 5% risk-free rate
      option.greeks.iv,
      option.type === "C"
    )
    // Bid is typically 1-3% below theoretical price due to bid-ask spread
    const bidPrice = theoreticalPrice * 0.98
    return bidPrice > 0.01 ? formatPrice(bidPrice) : "$0.01"
  }

  const getAskPrice = (option: OptionData & { greeks: GreeksData }) => {
    if (option.ask && option.ask > 0) {
      return formatPrice(option.ask)
    }
    // Calculate theoretical price using Black-Scholes
    const theoreticalPrice = calculateBlackScholesPrice(
      spotPrice,
      option.strike,
      option.daysTillExp || 0.1,
      0.05, // 5% risk-free rate
      option.greeks.iv,
      option.type === "C"
    )
    // Ask is typically 1-3% above theoretical price due to bid-ask spread
    const askPrice = theoreticalPrice * 1.02
    return askPrice > 0.01 ? formatPrice(askPrice) : "$0.02"
  }

  const isAtTheMoney = (strike: number) => Math.abs(strike - spotPrice) <= 0.5

  return (
    <div className="space-y-4">
      {/* Option Chain Table Container */}
      <div className="relative border border-[#1A1A1A] rounded overflow-hidden">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-black/95 backdrop-blur-sm border-b border-[#1A1A1A]">
          <div className="grid grid-cols-7 gap-2 px-4 py-2.5 text-[10px] font-mono font-medium uppercase tracking-wider text-[#525252]">
            <div className="text-center text-terminal-green/80">Call Bid / Ask</div>
            <div className="text-center">Delta / IV</div>
            <div className="text-center">Vol / OI</div>
            <div className="text-center text-[#E5E5E5] font-semibold">Strike</div>
            <div className="text-center">Vol / OI</div>
            <div className="text-center">Delta / IV</div>
            <div className="text-center text-terminal-red/80">Put Bid / Ask</div>
          </div>
        </div>

        {/* Option rows */}
        <div className="divide-y divide-[#111] bg-black">
          {processedData.map((option) => {
            const isSelected = selectedStrike === option.strike
            const isATM = isAtTheMoney(option.strike)
            
            return (
            <div key={option.strike} className="space-y-0">
              <div
                className={cn(
                  "grid grid-cols-7 gap-2 px-4 py-2.5 text-xs font-mono cursor-pointer transition-all duration-150 hover:bg-[#0A0A0A] border-l-2 border-r-2 border-transparent",
                  isATM && "bg-[#1A1A1A]/20 border-l-terminal-green/40 border-r-terminal-green/40",
                  isSelected && "bg-[#161616]"
                )}
                onClick={() => setSelectedStrike(isSelected ? null : option.strike)}
              >
                {/* Call side */}
                <div className="text-center flex flex-col justify-center">
                  <div className="text-terminal-green font-semibold">
                    {option.call ? getAskPrice(option.call) : "-"}
                  </div>
                  <div className="text-terminal-green/60 text-[10px]">
                    {option.call ? getBidPrice(option.call) : "-"}
                  </div>
                </div>
                <div className="text-center flex flex-col justify-center text-[#E5E5E5]">
                  <div>
                    {option.call ? formatGreek(option.call.greeks.delta, 3) : "-"}
                  </div>
                  <div className="text-[#525252] text-[10px]">
                    {option.call ? formatPercent(option.call.greeks.iv) : "-"}
                  </div>
                </div>
                <div className="text-center flex flex-col justify-center text-[#737373]">
                  <div>
                    {option.call?.volume?.toLocaleString() || "-"}
                  </div>
                  <div className="text-[#333] text-[10px]">
                    {option.call?.open_interest.toLocaleString() || "-"}
                  </div>
                </div>

                {/* Strike column */}
                <div className={cn(
                  "text-center font-bold flex items-center justify-center text-sm",
                  isATM ? "text-terminal-green" : "text-white"
                )}>
                  {formatPrice(option.strike)}
                  {isSelected ? (
                    <ChevronUp className="w-3 h-3 ml-1 text-[#525252]" />
                  ) : (
                    <ChevronDown className="w-3 h-3 ml-1 text-[#525252]" />
                  )}
                </div>

                {/* Put side */}
                <div className="text-center flex flex-col justify-center text-[#737373]">
                  <div>
                    {option.put?.volume?.toLocaleString() || "-"}
                  </div>
                  <div className="text-[#333] text-[10px]">
                    {option.put?.open_interest.toLocaleString() || "-"}
                  </div>
                </div>
                <div className="text-center flex flex-col justify-center text-[#E5E5E5]">
                  <div>
                    {option.put ? formatGreek(option.put.greeks.delta, 3) : "-"}
                  </div>
                  <div className="text-[#525252] text-[10px]">
                    {option.put ? formatPercent(option.put.greeks.iv) : "-"}
                  </div>
                </div>
                <div className="text-center flex flex-col justify-center">
                  <div className="text-terminal-red font-semibold">
                    {option.put ? getAskPrice(option.put) : "-"}
                  </div>
                  <div className="text-terminal-red/60 text-[10px]">
                    {option.put ? getBidPrice(option.put) : "-"}
                  </div>
                </div>
              </div>

              {/* Expanded details for selected strike */}
              {isSelected && (
                <div className="bg-[#0A0A0A] border-t border-b border-[#1A1A1A] p-4 space-y-4">
                  <div className="text-center">
                    <h4 className="text-sm font-semibold font-mono text-[#E5E5E5]">
                      {ticker} {formatPrice(option.strike)} STRIKE METRICS
                    </h4>
                    <p className="text-xxs text-[#525252] font-mono mt-0.5">
                      EXPIRATION: {selectedExpiry}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Call Details */}
                    {option.call && (
                      <div className="bg-black border border-[#1A1A1A] rounded p-4 space-y-3">
                        <div className="text-terminal-green text-xs font-mono font-bold border-b border-[#1A1A1A] pb-1.5 uppercase tracking-wider text-center">Call Contract</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs font-mono">
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">BID</span>
                            <span className="text-terminal-green font-semibold">{getBidPrice(option.call)}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">DELTA</span>
                            <span className="text-[#E5E5E5]">{formatGreek(option.call.greeks.delta, 4)}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">ASK</span>
                            <span className="text-terminal-green font-semibold">{getAskPrice(option.call)}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">GAMMA</span>
                            <span className="text-[#E5E5E5]">{formatGreek(option.call.greeks.gamma, 4)}</span>
                          </div>
                          {option.call.last && option.call.last > 0 && (
                            <div className="flex justify-between border-b border-[#111] pb-1 col-span-2">
                              <span className="text-[#525252]">LAST</span>
                              <span className="text-[#E5E5E5]">{formatPrice(option.call.last)}</span>
                            </div>
                          )}
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">VOLUME</span>
                            <span className="text-[#E5E5E5]">{option.call.volume?.toLocaleString() || "0"}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">THETA</span>
                            <span className="text-[#E5E5E5]">{formatGreek(option.call.greeks.theta, 4)}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">OPEN INT</span>
                            <span className="text-[#E5E5E5]">{option.call.open_interest.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">VEGA</span>
                            <span className="text-[#E5E5E5]">{formatGreek(option.call.greeks.vega, 4)}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">IV</span>
                            <span className="text-[#E5E5E5]">{formatPercent(option.call.greeks.iv)}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">RHO</span>
                            <span className="text-[#E5E5E5]">{formatGreek(option.call.greeks.rho, 4)}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Put Details */}
                    {option.put && (
                      <div className="bg-black border border-[#1A1A1A] rounded p-4 space-y-3">
                        <div className="text-terminal-red text-xs font-mono font-bold border-b border-[#1A1A1A] pb-1.5 uppercase tracking-wider text-center">Put Contract</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs font-mono">
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">BID</span>
                            <span className="text-terminal-red font-semibold">{getBidPrice(option.put)}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">DELTA</span>
                            <span className="text-[#E5E5E5]">{formatGreek(option.put.greeks.delta, 4)}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">ASK</span>
                            <span className="text-terminal-red font-semibold">{getAskPrice(option.put)}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">GAMMA</span>
                            <span className="text-[#E5E5E5]">{formatGreek(option.put.greeks.gamma, 4)}</span>
                          </div>
                          {option.put.last && option.put.last > 0 && (
                            <div className="flex justify-between border-b border-[#111] pb-1 col-span-2">
                              <span className="text-[#525252]">LAST</span>
                              <span className="text-[#E5E5E5]">{formatPrice(option.put.last)}</span>
                            </div>
                          )}
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">VOLUME</span>
                            <span className="text-[#E5E5E5]">{option.put.volume?.toLocaleString() || "0"}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">THETA</span>
                            <span className="text-[#E5E5E5]">{formatGreek(option.put.greeks.theta, 4)}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">OPEN INT</span>
                            <span className="text-[#E5E5E5]">{option.put.open_interest.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">VEGA</span>
                            <span className="text-[#E5E5E5]">{formatGreek(option.put.greeks.vega, 4)}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">IV</span>
                            <span className="text-[#E5E5E5]">{formatPercent(option.put.greeks.iv)}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#111] pb-1">
                            <span className="text-[#525252]">RHO</span>
                            <span className="text-[#E5E5E5]">{formatGreek(option.put.greeks.rho, 4)}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
        </div>

        {processedData.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            No option data available for the selected expiry.
          </div>
        )}
      </div>
    </div>
  )
}
