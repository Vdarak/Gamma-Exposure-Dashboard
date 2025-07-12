import type { OptionData } from "./types"
import { fixOptionData } from "./calculations"

export type Market = 'USA' | 'INDIA'

export class DataService {
  private cache = new Map<string, { data: any; timestamp: number }>()
  private readonly CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

  async fetchOptionData(ticker: string, market: Market = 'USA'): Promise<{ spotPrice: number; optionData: OptionData[] }> {
    const cacheKey = `${market}-${ticker}`
    
    // Check cache first
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      const spotPrice = cached.data.current_price
      const optionData = fixOptionData(cached.data.options)
      return { spotPrice, optionData }
    }

    try {
      // Use appropriate API route based on market
      const apiRoute = market === 'INDIA' ? `/api/options/india/${ticker}` : `/api/options/${ticker}`
      const response = await fetch(apiRoute)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }))
        throw new Error(errorData.error || `Failed to fetch data for ${ticker}`)
      }

      const data = await response.json()

      // Additional validation
      if (!data.current_price || typeof data.current_price !== "number") {
        throw new Error(`Invalid price data received for ${ticker}`)
      }

      if (!Array.isArray(data.options) || data.options.length === 0) {
        const exchange = market === 'INDIA' ? 'NSE/BSE' : 'CBOE'
        throw new Error(`No options data available for ${ticker}. This ticker may not have options listed on ${exchange}.`)
      }

      // Cache the response
      this.cache.set(cacheKey, { data, timestamp: Date.now() })

      const spotPrice = data.current_price
      const optionData = fixOptionData(data.options)

      if (optionData.length === 0) {
        throw new Error(`Unable to parse options data for ${ticker}. The data format may be unsupported.`)
      }

      const currency = market === 'INDIA' ? '₹' : '$'
      console.log(`Successfully processed ${optionData.length} options for ${ticker} at price ${currency}${spotPrice}`)

      return { spotPrice, optionData }
    } catch (error) {
      console.error("Error fetching option data:", error)
      throw new Error(
        error instanceof Error
          ? error.message
          : `Unable to fetch data for ticker ${ticker}. Please check if the ticker is valid.`,
      )
    }
  }

  clearCache() {
    this.cache.clear()
  }
}

export const dataService = {
  async fetchOptionData(ticker: string, market: Market = 'USA'): Promise<{ spotPrice: number; optionData: OptionData[] }> {
    // The narrative here is that we're making a primary, critical request for application data.
    // The `keepalive` option, which caused the issue in Chrome with large payloads,
    // is meant for non-critical, "fire-and-forget" requests when a page unloads.
    // By removing it, we ensure our request is handled through the standard, robust browser channel
    // for fetching essential content, which has no such payload size limitation.
    const apiRoute = market === 'INDIA' ? `/api/options/india/${ticker.toUpperCase()}` : `/api/options/${ticker.toUpperCase()}`
    const res = await fetch(apiRoute, {
      // keepalive: true, // <-- This was the likely culprit. Removing it.
      cache: "no-store", // Ensure we always get the latest data.
    })

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: "Unknown error" }))
      throw new Error(errorData.error || `Failed to fetch data for ${ticker}`)
    }

    const data = await res.json()

    // Additional validation
    if (!data.current_price || typeof data.current_price !== "number") {
      throw new Error(`Invalid price data received for ${ticker}`)
    }

    if (!Array.isArray(data.options) || data.options.length === 0) {
      const exchange = market === 'INDIA' ? 'NSE/BSE' : 'CBOE'
      throw new Error(`No options data available for ${ticker}. This ticker may not have options listed on ${exchange}.`)
    }

    const spotPrice = data.current_price
    const optionData = fixOptionData(data.options)

    if (optionData.length === 0) {
      throw new Error(`Unable to parse options data for ${ticker}. The data format may be unsupported.`)
    }

    const currency = market === 'INDIA' ? '₹' : '$'
    console.log(`Successfully processed ${optionData.length} options for ${ticker} at price ${currency}${spotPrice}`)

    return { spotPrice, optionData }
  },
}
