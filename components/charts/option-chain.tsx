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
      {/* Current Price Indicator */}
      <div className="flex items-center justify-center py-4">
        <div className="flex items-center space-x-2 bg-yellow-500/20 px-4 py-2 rounded-lg border border-yellow-500/30">
          <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
          <span className="text-yellow-400 font-semibold">
            {ticker} Spot: {formatPrice(spotPrice)}
          </span>
        </div>
      </div>

      {/* Option Chain Table Container */}
      <div className="relative">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur-sm border-b border-gray-700">
          <div className="grid grid-cols-7 gap-4 px-4 py-3 text-xs font-medium text-gray-300">
            <div className="text-center text-green-400">Calls</div>
            <div className="text-center text-green-400">Delta/IV</div>
            <div className="text-center text-green-400">Vol/OI</div>
            <div className="text-center font-semibold">Strike</div>
            <div className="text-center text-red-400">Vol/OI</div>
            <div className="text-center text-red-400">Delta/IV</div>
            <div className="text-center text-red-400">Puts</div>
          </div>
        </div>

        {/* Option rows */}
        <div className="space-y-1">
          {processedData.map((option) => {
            const isSelected = selectedStrike === option.strike
            const isATM = isAtTheMoney(option.strike)
            
            return (
            <div key={option.strike} className="space-y-0">
              <div
                className={cn(
                  "grid grid-cols-7 gap-4 px-4 py-3 text-sm cursor-pointer transition-all duration-200 hover:bg-gray-800/30 border border-transparent",
                  isATM && "bg-blue-500/10 border-blue-500/30",
                  isSelected && "bg-gray-700/50 border-gray-600"
                )}
                onClick={() => setSelectedStrike(isSelected ? null : option.strike)}
              >
                {/* Call side */}
                <div className="text-center">
                  <div className="text-green-400 text-xs">
                    Ask: {option.call ? getAskPrice(option.call) : "-"}
                  </div>
                  <div className="text-green-300 text-xs">
                    Bid: {option.call ? getBidPrice(option.call) : "-"}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-green-400 text-xs">
                    Δ: {option.call ? formatGreek(option.call.greeks.delta, 3) : "-"}
                  </div>
                  <div className="text-green-300 text-xs">
                    IV: {option.call ? formatPercent(option.call.greeks.iv) : "-"}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-green-400 text-xs">
                    Vol: {option.call?.volume?.toLocaleString() || "-"}
                  </div>
                  <div className="text-green-300 text-xs">
                    OI: {option.call?.open_interest.toLocaleString() || "-"}
                  </div>
                </div>

                {/* Strike column */}
                <div className={cn(
                  "text-center font-semibold flex items-center justify-center",
                  isATM ? "text-blue-400" : "text-white"
                )}>
                  {formatPrice(option.strike)}
                  {isSelected ? (
                    <ChevronUp className="w-4 h-4 ml-1" />
                  ) : (
                    <ChevronDown className="w-4 h-4 ml-1" />
                  )}
                </div>

                {/* Put side */}
                <div className="text-center">
                  <div className="text-red-400 text-xs">
                    Vol: {option.put?.volume?.toLocaleString() || "-"}
                  </div>
                  <div className="text-red-300 text-xs">
                    OI: {option.put?.open_interest.toLocaleString() || "-"}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-red-400 text-xs">
                    Δ: {option.put ? formatGreek(option.put.greeks.delta, 3) : "-"}
                  </div>
                  <div className="text-red-300 text-xs">
                    IV: {option.put ? formatPercent(option.put.greeks.iv) : "-"}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-red-400 text-xs">
                    Ask: {option.put ? getAskPrice(option.put) : "-"}
                  </div>
                  <div className="text-red-300 text-xs">
                    Bid: {option.put ? getBidPrice(option.put) : "-"}
                  </div>
                </div>
              </div>

              {/* Expanded details for selected strike */}
              {isSelected && (
                <div className="bg-gray-900/50 border border-gray-700 rounded-lg mx-4 p-6 space-y-6">
                  <div className="text-center">
                    <h4 className="text-lg font-semibold text-white mb-2">
                      {ticker} ${option.strike} Strike Details
                    </h4>
                    <p className="text-sm text-gray-400">
                      Expiring {selectedExpiry}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Call Details */}
                    {option.call && (
                      <Card className="bg-green-500/10 border-green-500/30">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-green-400 text-center">Call Option</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="space-y-2">
                              <div className="flex justify-between">
                                <span className="text-gray-400">Bid:</span>
                                <span className="text-green-400">
                                  {getBidPrice(option.call)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Ask:</span>
                                <span className="text-green-400">
                                  {getAskPrice(option.call)}
                                </span>
                              </div>
                              {option.call.last && option.call.last > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-gray-400">Last:</span>
                                  <span className="text-white">
                                    {formatPrice(option.call.last)}
                                  </span>
                                </div>
                              )}
                              <div className="flex justify-between">
                                <span className="text-gray-400">Volume:</span>
                                <span className="text-white">
                                  {option.call.volume?.toLocaleString() || "0"}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Open Interest:</span>
                                <span className="text-white">
                                  {option.call.open_interest.toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">IV:</span>
                                <span className="text-white">
                                  {formatPercent(option.call.greeks.iv)}
                                </span>
                              </div>
                            </div>
                            
                            <div className="space-y-2">
                              <div className="text-center mb-2">
                                <span className="text-xs text-gray-400 uppercase tracking-wide">Greeks</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Delta:</span>
                                <span className="text-white">
                                  {formatGreek(option.call.greeks.delta, 4)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Gamma:</span>
                                <span className="text-white">
                                  {formatGreek(option.call.greeks.gamma, 4)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Theta:</span>
                                <span className="text-white">
                                  {formatGreek(option.call.greeks.theta, 4)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Vega:</span>
                                <span className="text-white">
                                  {formatGreek(option.call.greeks.vega, 4)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Rho:</span>
                                <span className="text-white">
                                  {formatGreek(option.call.greeks.rho, 4)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Put Details */}
                    {option.put && (
                      <Card className="bg-red-500/10 border-red-500/30">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-red-400 text-center">Put Option</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="space-y-2">
                              <div className="flex justify-between">
                                <span className="text-gray-400">Bid:</span>
                                <span className="text-red-400">
                                  {getBidPrice(option.put)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Ask:</span>
                                <span className="text-red-400">
                                  {getAskPrice(option.put)}
                                </span>
                              </div>
                              {option.put.last && option.put.last > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-gray-400">Last:</span>
                                  <span className="text-white">
                                    {formatPrice(option.put.last)}
                                  </span>
                                </div>
                              )}
                              <div className="flex justify-between">
                                <span className="text-gray-400">Volume:</span>
                                <span className="text-white">
                                  {option.put.volume?.toLocaleString() || "0"}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Open Interest:</span>
                                <span className="text-white">
                                  {option.put.open_interest.toLocaleString()}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">IV:</span>
                                <span className="text-white">
                                  {formatPercent(option.put.greeks.iv)}
                                </span>
                              </div>
                            </div>
                            
                            <div className="space-y-2">
                              <div className="text-center mb-2">
                                <span className="text-xs text-gray-400 uppercase tracking-wide">Greeks</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Delta:</span>
                                <span className="text-white">
                                  {formatGreek(option.put.greeks.delta, 4)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Gamma:</span>
                                <span className="text-white">
                                  {formatGreek(option.put.greeks.gamma, 4)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Theta:</span>
                                <span className="text-white">
                                  {formatGreek(option.put.greeks.theta, 4)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Vega:</span>
                                <span className="text-white">
                                  {formatGreek(option.put.greeks.vega, 4)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Rho:</span>
                                <span className="text-white">
                                  {formatGreek(option.put.greeks.rho, 4)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
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
