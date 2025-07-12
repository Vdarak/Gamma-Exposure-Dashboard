import type { OptionData } from "./types"
import { fixOptionData } from "./calculations"

export class DataService {
  private cache = new Map<string, { data: any; timestamp: number }>()
  private readonly CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

  async fetchOptionData(ticker: string): Promise<{ spotPrice: number; optionData: OptionData[] }> {
    // Check cache first
    const cached = this.cache.get(ticker)
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      const spotPrice = cached.data.current_price
      const optionData = fixOptionData(cached.data.options)
      return { spotPrice, optionData }
    }

    try {
      // Use our API route instead of direct CBOE API call
      const response = await fetch(`/api/options/${ticker}`)

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
        throw new Error(`No options data available for ${ticker}. This ticker may not have options listed on CBOE.`)
      }

      // Cache the response
      this.cache.set(ticker, { data, timestamp: Date.now() })

      const spotPrice = data.current_price
      const optionData = fixOptionData(data.options)

      if (optionData.length === 0) {
        throw new Error(`Unable to parse options data for ${ticker}. The data format may be unsupported.`)
      }

      console.log(`Successfully processed ${optionData.length} options for ${ticker} at price ${spotPrice}`)

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
  async fetchOptionData(ticker: string): Promise<{ spotPrice: number; optionData: OptionData[] }> {
    // The narrative here is that we're making a primary, critical request for application data.
    // The `keepalive` option, which caused the issue in Chrome with large payloads,
    // is meant for non-critical, "fire-and-forget" requests when a page unloads.
    // By removing it, we ensure our request is handled through the standard, robust browser channel
    // for fetching essential content, which has no such payload size limitation.
    const res = await fetch(`/api/options/${ticker.toUpperCase()}`, {
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
      throw new Error(`No options data available for ${ticker}. This ticker may not have options listed on CBOE.`)
    }

    const spotPrice = data.current_price
    const optionData = fixOptionData(data.options)

    if (optionData.length === 0) {
      throw new Error(`Unable to parse options data for ${ticker}. The data format may be unsupported.`)
    }

    console.log(`Successfully processed ${optionData.length} options for ${ticker} at price ${spotPrice}`)

    return { spotPrice, optionData }
  },
}
