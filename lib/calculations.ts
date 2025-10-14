import type { OptionData, GEXByStrike, GEXByExpiration, CallPutWalls, ExpectedMove } from "./types"

/**
 * Standard contract size for options (typically 100 shares per contract).
 */
const CONTRACT_SIZE = 100

/**
 * Pricing method for options calculations
 */
export type PricingMethod = 'black-scholes' | 'binomial'

/**
 * Calculates the Gamma Exposure (GEX) for a single European-style option using the Black-Scholes model.
 *
 * The function first calculates the raw gamma of the option and then scales it by Open Interest (OI),
 * contract size, spot price squared, and a 0.01 factor to represent GEX in terms of dollar value change
 * for a 1% move in the underlying, per contract, then multiplied by OI.
 *
 * Uses the standard Black-Scholes gamma formula, which is identical for both calls and puts.
 *
 * @param S - Current spot price of the underlying asset.
 * @param K - Strike price of the option.
 * @param vol - Implied volatility of the option (annualized, e.g., 0.2 for 20%).
 * @param T - Time to expiration in years (e.g., 0.5 for 6 months).
 * @param r - Risk-free interest rate (annualized, e.g., 0.05 for 5%). Defaults to 0.
 * @param q - Continuous dividend yield of the underlying asset (annualized, e.g., 0.02 for 2%). Defaults to 0.
 * @param optType - Type of the option, either "call" or "put".
 * @param OI - Open interest for the option.
 * @returns The calculated Gamma Exposure for the option. Returns 0 if inputs are invalid or lead to numerical errors.
 */
export function calcGammaEx(
  S: number, // Spot price
  K: number, // Strike price
  vol: number, // Volatility
  T: number, // Time to expiration
  r = 0, // Risk-free rate
  q = 0, // Dividend yield
  optType: "call" | "put",
  OI: number, // Open interest
): number {
  if (T === 0 || vol === 0 || S === 0) return 0
  if (K <= 0 || vol <= 0 || T < 0) return 0

  T = Math.max(T, 1e-8)
  vol = Math.max(vol, 1e-8)

  try {
    const dp = (Math.log(S / K) + (r - q + 0.5 * vol ** 2) * T) / (vol * Math.sqrt(T))

    // Standard normal probability density function
    const normPdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)

    // Standard Black-Scholes gamma formula (identical for calls and puts)
    const gamma = (Math.exp(-q * T) * normPdf(dp)) / (S * vol * Math.sqrt(T))
    
    return OI * 100 * S * S * 0.01 * gamma
  } catch (error) {
    console.warn(`Numerical error in calcGammaEx with inputs: S=${S}, K=${K}, vol=${vol}, T=${T}`)
    return 0
  }
}

/**
 * American option pricing using Binomial Tree Model
 * Handles early exercise features better than Black-Scholes
 */
export function americanOptionPrice(
  spot: number,
  strike: number,
  timeToExpiry: number,
  riskFreeRate: number,
  volatility: number,
  isCall: boolean,
  steps: number = 100
): number {
  if (timeToExpiry <= 0 || volatility <= 0 || spot <= 0 || strike <= 0) return 0
  
  const dt = timeToExpiry / steps
  const u = Math.exp(volatility * Math.sqrt(dt)) // Up factor
  const d = 1 / u // Down factor
  const p = (Math.exp(riskFreeRate * dt) - d) / (u - d) // Risk-neutral probability
  const discount = Math.exp(-riskFreeRate * dt)

  // Initialize asset prices at maturity
  const optionValues: number[] = []

  // Calculate intrinsic values at final nodes
  for (let i = 0; i <= steps; i++) {
    const price = spot * Math.pow(u, steps - i) * Math.pow(d, i)
    
    // Calculate intrinsic value at expiration
    if (isCall) {
      optionValues[i] = Math.max(price - strike, 0)
    } else {
      optionValues[i] = Math.max(strike - price, 0)
    }
  }

  // Work backwards through the tree
  for (let step = steps - 1; step >= 0; step--) {
    for (let i = 0; i <= step; i++) {
      // Current asset price at this node
      const currentPrice = spot * Math.pow(u, step - i) * Math.pow(d, i)
      
      // Calculate continuation value (expected value)
      const continuationValue = discount * (p * optionValues[i] + (1 - p) * optionValues[i + 1])
      
      // Calculate intrinsic value (immediate exercise)
      let intrinsicValue: number
      if (isCall) {
        intrinsicValue = Math.max(currentPrice - strike, 0)
      } else {
        intrinsicValue = Math.max(strike - currentPrice, 0)
      }
      
      // For American options, take the maximum of continuation and intrinsic value
      optionValues[i] = Math.max(continuationValue, intrinsicValue)
    }
  }

  return optionValues[0]
}

/**
 * Calculate delta for American options using finite difference
 */
export function americanDelta(
  spot: number,
  strike: number,
  timeToExpiry: number,
  riskFreeRate: number,
  volatility: number,
  isCall: boolean,
  steps: number = 100
): number {
  const dS = spot * 0.01 // 1% bump
  
  const priceUp = americanOptionPrice(spot + dS, strike, timeToExpiry, riskFreeRate, volatility, isCall, steps)
  const priceDown = americanOptionPrice(spot - dS, strike, timeToExpiry, riskFreeRate, volatility, isCall, steps)
  
  return (priceUp - priceDown) / (2 * dS)
}

/**
 * Calculate gamma for American options using finite difference
 */
export function americanGamma(
  spot: number,
  strike: number,
  timeToExpiry: number,
  riskFreeRate: number,
  volatility: number,
  isCall: boolean,
  steps: number = 100
): number {
  const dS = spot * 0.01 // 1% bump
  
  const deltaUp = americanDelta(spot + dS, strike, timeToExpiry, riskFreeRate, volatility, isCall, steps)
  const deltaDown = americanDelta(spot - dS, strike, timeToExpiry, riskFreeRate, volatility, isCall, steps)
  
  return (deltaUp - deltaDown) / (2 * dS)
}

/**
 * Enhanced Gamma Exposure calculation with support for both Black-Scholes and Binomial pricing
 */
export function calcGammaExEnhanced(
  S: number, // Spot price
  K: number, // Strike price
  vol: number, // Volatility
  T: number, // Time to expiration
  r = 0, // Risk-free rate
  q = 0, // Dividend yield
  optType: "call" | "put",
  OI: number, // Open interest
  pricingMethod: PricingMethod = 'black-scholes'
): number {
  if (pricingMethod === 'black-scholes') {
    return calcGammaEx(S, K, vol, T, r, q, optType, OI)
  }
  
  // Binomial method
  if (T === 0 || vol === 0 || S === 0) return 0
  if (K <= 0 || vol <= 0 || T < 0) return 0

  T = Math.max(T, 1e-8)
  vol = Math.max(vol, 1e-8)

  try {
    const isCall = optType === "call"
    const gamma = americanGamma(S, K, T, r, vol, isCall)
    
    return OI * 100 * S * S * 0.01 * gamma
  } catch (error) {
    console.warn(`Numerical error in calcGammaExEnhanced (binomial) with inputs: S=${S}, K=${K}, vol=${vol}, T=${T}`)
    return 0
  }
}

/**
 * Parses and transforms raw option data from an array of any type into a structured `OptionData[]` format.
 *
 * This function attempts to extract key option parameters (name, type, strike, expiration, gamma, OI, IV, delta)
 * from various possible field names in the input items. It includes robust parsing for expiration dates,
 * handling different string formats (YYMMDD from symbol, YYYY-MM-DD, MM/DD/YYYY) and timestamps.
 *
 * It filters out options with invalid strikes, zero open interest, or unparseable expiration dates.
 * Fallback values are used if critical data is missing to prevent crashes, with warnings logged.
 *
 * @param data - An array of raw option data items. Each item can be an object with varying property names.
 * @param pricingMethod - The pricing method to use for calculations ('black-scholes' or 'binomial').
 * @returns An array of `OptionData` objects, cleaned and structured.
 */
export function fixOptionData(data: any[], pricingMethod: PricingMethod = 'black-scholes'): OptionData[] {
  if (!Array.isArray(data)) {
    console.error("Options data is not an array:", data)
    return []
  }

  const currentYear = new Date().getUTCFullYear()
  const currentCentury = Math.floor(currentYear / 100) * 100 // e.g., 2000

  return data
    .map((item, index) => {
      try {
        const optionName = item.option || item.symbol || ""
        const typeMatch = optionName.match(/\d([CP])\d/) || optionName.match(/([CP])\d/)
        const strikeMatch = optionName.match(/\d[CP](\d+)\d\d\d/) || optionName.match(/[CP](\d+)/)
        // Standard option symbol expiration: YYMMDD
        const expirationSymbolMatch =
          optionName.match(/[A-Z](\d{2})(\d{2})(\d{2})[CP]/) || optionName.match(/^[A-Z_]*(\d{2})(\d{2})(\d{2})[CP]/)

        const type = (typeMatch ? typeMatch[1] : item.type || item.option_type || "C") as "C" | "P"

        let strike = strikeMatch ? Number.parseInt(strikeMatch[1]) : 0
        if (!strike && item.strike) {
          strike = Number.parseFloat(item.strike)
        }

        let expiration: Date
        const rawExpirationField = item.expiration || item.exp_date || item.expiration_date

        // Path 1: Try parsing from option symbol (YYMMDD format)
        if (expirationSymbolMatch) {
          const yearYY = Number.parseInt(expirationSymbolMatch[1], 10)
          const month = Number.parseInt(expirationSymbolMatch[2], 10) - 1 // JS months are 0-indexed
          const day = Number.parseInt(expirationSymbolMatch[3], 10)

          // Heuristic for YY: if yy < 70, assume 20yy, else 19yy (adjust if CBOE uses a different cutoff)
          // For financial options, it's almost always current century or next few decades.
          let fullYear = currentCentury + yearYY
          // If parsed year is far in the past (e.g. 2000 for '00' when current year is 2025, but symbol meant 2100),
          // or if it implies a year like 2070+ from a small YY, this might need adjustment based on typical option lifespans.
          // For now, simple currentCentury + yearYY is a common approach.
          // If current year is 2025 and yearYY is 00, fullYear becomes 2000. This is the problem.
          // If yearYY is less than (currentYear % 100) + 10 (e.g. < 25+10=35 for 2025), it's likely next century for very short YY.
          // However, CBOE symbols are usually for the current century.
          // A common convention: if yearYY < 50 (or some threshold), it's 20YY, else 19YY.
          // Given current date, if yearYY is e.g. 00-49, it's 2000-2049. If 50-99, it's 1950-1999.
          // For options, we expect dates in the near future.
          if (yearYY < (currentYear % 100) + 20 && yearYY >= currentYear % 100) {
            // If YY is current year or up to 20 years in future
            fullYear = currentCentury + yearYY
          } else if (yearYY < currentYear % 100) {
            // If YY is in the past relative to current year's YY, assume next century
            fullYear = currentCentury + 100 + yearYY
          } else {
            // Default to current century
            fullYear = currentCentury + yearYY
          }
          // A simpler robust approach for options: assume all YY are 20YY.
          fullYear = 2000 + yearYY

          expiration = new Date(Date.UTC(fullYear, month, day))
          // console.log(`Parsed from symbol ${optionName}: YY=${yearYY}, M=${month+1}, D=${day} -> ${expiration.toISOString()}`);
        } else if (rawExpirationField) {
          // Path 2: Try parsing from a dedicated expiration field
          const expStr = String(rawExpirationField)
          let parsedDateAttempt: Date | null = null

          if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/.test(expStr)) {
            // YYYY-MM-DD or ISO string
            const parts = expStr.substring(0, 10).split("-")
            parsedDateAttempt = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])))
          } else if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(expStr)) {
            // MM/DD/YYYY or M/D/YY etc.
            const parts = expStr.split("/")
            const yearPart = Number(parts[2])
            let fullYear = yearPart
            if (yearPart < 100) {
              // Handle YY
              fullYear = (yearPart >= 70 ? 1900 : 2000) + yearPart // Common heuristic
            }
            parsedDateAttempt = new Date(Date.UTC(fullYear, Number(parts[0]) - 1, Number(parts[1])))
          } else if (!isNaN(Number(expStr)) && Number(expStr) > 1000000000) {
            // Possible timestamp (seconds or ms)
            let ts = Number(expStr)
            if (ts < 100000000000) ts *= 1000 // If seconds, convert to ms
            parsedDateAttempt = new Date(ts) // This will be in local TZ, convert to UTC components
            if (parsedDateAttempt && !isNaN(parsedDateAttempt.getTime())) {
              parsedDateAttempt = new Date(
                Date.UTC(
                  parsedDateAttempt.getUTCFullYear(),
                  parsedDateAttempt.getUTCMonth(),
                  parsedDateAttempt.getUTCDate(),
                ),
              )
            }
          } else {
            // General fallback parsing
            parsedDateAttempt = new Date(expStr)
            if (parsedDateAttempt && !isNaN(parsedDateAttempt.getTime())) {
              parsedDateAttempt = new Date(
                Date.UTC(
                  parsedDateAttempt.getUTCFullYear(),
                  parsedDateAttempt.getUTCMonth(),
                  parsedDateAttempt.getUTCDate(),
                ),
              )
            }
          }

          if (parsedDateAttempt && !isNaN(parsedDateAttempt.getTime())) {
            expiration = parsedDateAttempt
            if (expiration.getUTCFullYear() < 2000 || expiration.getUTCFullYear() > currentYear + 20) {
              // Sanity check: year reasonable
              console.warn(
                `Potentially incorrect year from field "${expStr}" for ${optionName}: ${expiration.toISOString()}. Item:`,
                item,
              )
            }
          } else {
            console.warn(`Failed to parse date field "${expStr}" for ${optionName}. Item:`, item)
            expiration = new Date(Date.UTC(currentYear, new Date().getUTCMonth(), new Date().getUTCDate() + 30)) // Fallback
          }
        } else {
          console.warn(`No expiration data found for ${optionName}. Item:`, item)
          expiration = new Date(Date.UTC(currentYear, new Date().getUTCMonth(), new Date().getUTCDate() + 30)) // Fallback
        }

        const gamma = Number.parseFloat(item.gamma || item.greeks?.gamma || 0) || 0
        const open_interest = Number.parseFloat(item.open_interest || item.openInterest || item.oi || 0) || 0
        const volume = Number.parseFloat(item.volume || item.vol || item.trade_volume || item.daily_volume || 0) || 0
        const iv = Number.parseFloat(item.iv || item.implied_volatility || item.impliedVolatility || 0) || 0
        const delta = Number.parseFloat(item.delta || item.greeks?.delta || 0) || 0
        
        // Parse bid/ask/last prices if available
        const bid = Number.parseFloat(item.bid || item.bid_price || 0) || undefined
        const ask = Number.parseFloat(item.ask || item.ask_price || item.offer || 0) || undefined  
        const last = Number.parseFloat(item.last || item.last_price || item.close || item.price || 0) || undefined

        return {
          option: optionName,
          type,
          strike,
          expiration,
          gamma,
          open_interest,
          volume,
          iv,
          delta,
          bid,
          ask,
          last,
        }
      } catch (error) {
        console.error(`Critical error parsing option data at index ${index}:`, error, item)
        return {
          option: item.option || `unknown_${index}`,
          type: "C" as const,
          strike: 0,
          expiration: new Date(
            Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 30),
          ), // Fallback
          gamma: 0,
          open_interest: 0,
          volume: 0,
          iv: 0,
          delta: 0,
          bid: undefined,
          ask: undefined,
          last: undefined,
        }
      }
    })
    .filter((option) => option.strike > 0 && option.open_interest > 0 && !isNaN(option.expiration.getTime()))
}

/**
 * Computes the total Gamma Exposure (GEX) for a portfolio of options.
 *
 * This function iterates through the provided option data, calculates the GEX for each option
 * (based on its pre-calculated gamma or a simplified GEX formula), and sums them up.
 * GEX for put options is treated as negative, reflecting the typical dealer positioning
 * (dealers are often short puts, which means positive gamma exposure for them,
 * but this function might be from the perspective of net market exposure where customer long puts are negative GEX).
 *
 * The total GEX is then converted to billions.
 *
 * @param spot - Current spot price of the underlying asset. Used in GEX calculation per option.
 * @param data - An array of `OptionData` objects, potentially with `gamma` pre-calculated.
 * @param pricingMethod - The pricing method to use ('black-scholes' or 'binomial').
 * @returns The total Gamma Exposure in billions.
 */
export function computeTotalGEX(spot: number, data: OptionData[], pricingMethod: PricingMethod = 'black-scholes'): number {
  const today = new Date()
  
  // Calculate GEX for each option using the specified pricing method if gamma is 0 or missing
  data.forEach((option) => {
    let gamma = option.gamma
    
    // If gamma is 0 or missing, calculate it using the specified pricing method
    if (!gamma || gamma === 0) {
      const daysTillExp = Math.max(1, (option.expiration.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      const timeToExpiry = daysTillExp / 365.25
      
      // Use a default volatility if IV is 0 or missing
      const volatility = option.iv && option.iv > 0 ? option.iv / 100 : 0.3 // Default 30% vol
      
      const optType = option.type === "C" ? "call" : "put"
      
      // Calculate gamma using the specified pricing method
      const gammaEx = calcGammaExEnhanced(
        spot,
        option.strike,
        volatility,
        timeToExpiry,
        0, // risk-free rate
        0, // dividend yield
        optType,
        1, // OI of 1 to get per-contract gamma
        pricingMethod
      )
      
      // Extract gamma per contract (divide by the scaling factors)
      gamma = gammaEx / (100 * spot * spot * 0.01)
      
      // Update the option object with calculated gamma
      option.gamma = gamma
    }
    
    option.GEX = spot * gamma * option.open_interest * CONTRACT_SIZE * spot * 0.01
    
    // For puts, gamma exposure is negative (dealers are net short gamma on puts)
    if (option.type === "P") {
      option.GEX = -option.GEX
    }
  })

  const totalGEX = data.reduce((sum, option) => sum + (option.GEX || 0), 0)
  return totalGEX / 1e9 // Convert to billions
}

/**
 * Computes Gamma Exposure (GEX) aggregated by strike price.
 *
 * For each option, it first calculates the time to expiration (`daysTillExp`).
 * Then, it calculates the GEX for each option using the specified pricing method.
 * GEX for put options is treated as negative.
 * The results are summed up for each strike price and converted to billions.
 *
 * @param spot - Current spot price of the underlying asset.
 * @param data - An array of `OptionData` objects.
 * @param pricingMethod - The pricing method to use ('black-scholes' or 'binomial').
 * @returns An array of `GEXByStrike` objects, sorted by strike price.
 */
export function computeGEXByStrike(spot: number, data: OptionData[], pricingMethod: PricingMethod = 'black-scholes'): GEXByStrike[] {
  // Calculate days till expiration
  const today = new Date()
  data.forEach((option) => {
    const daysDiff = Math.max(1, Math.ceil((option.expiration.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)))
    option.daysTillExp = daysDiff === 0 ? 1 / 262 : daysDiff / 262
  })

  // Calculate GEX using the specified pricing method
  data.forEach((option) => {
    if (option.type === "C") {
      option.GEX_BS = calcGammaExEnhanced(
        spot,
        option.strike,
        option.iv,
        option.daysTillExp!,
        0,
        0,
        "call",
        option.open_interest,
        pricingMethod
      )
    } else {
      option.GEX_BS = -calcGammaExEnhanced(
        spot,
        option.strike,
        option.iv,
        option.daysTillExp!,
        0,
        0,
        "put",
        option.open_interest,
        pricingMethod
      )
    }
  })

  // Group by strike
  const gexByStrike = new Map<number, number>()
  data.forEach((option) => {
    const currentGEX = gexByStrike.get(option.strike) || 0
    gexByStrike.set(option.strike, currentGEX + (option.GEX_BS || 0))
  })

  // Filter to ±15% from spot price and convert to billions
  const result: GEXByStrike[] = []
  gexByStrike.forEach((gex, strike) => {
    result.push({ strike, gex: gex / 1e9 })
  })

  return result.sort((a, b) => a.strike - b.strike)
}

/**
 * Computes Gamma Exposure (GEX) aggregated by expiration date.
 *
 * Filters options to include only those expiring within the next year.
 * It uses the pre-calculated `GEX` field on each `OptionData` object (which should be populated by `computeTotalGEX`
 * or a similar function that calculates individual option GEX).
 * The GEX values are summed for each unique expiration date and converted to billions.
 *
 * @param data - An array of `OptionData` objects, expected to have a `GEX` field.
 * @returns An array of `GEXByExpiration` objects, sorted by expiration date.
 */
export function computeGEXByExpiration(data: OptionData[]): GEXByExpiration[] {
  // Limit to one year
  const oneYearFromNow = new Date()
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1)

  const filteredData = data.filter((option) => option.expiration < oneYearFromNow)

  // Group by expiration
  const gexByExpiration = new Map<string, number>()
  filteredData.forEach((option) => {
    const dateKey = option.expiration.toISOString().split("T")[0]
    const currentGEX = gexByExpiration.get(dateKey) || 0
    gexByExpiration.set(dateKey, currentGEX + (option.GEX || 0))
  })

  const result: GEXByExpiration[] = []
  gexByExpiration.forEach((gex, expiration) => {
    result.push({ expiration, gex: gex / 1e9 })
  })

  return result.sort((a, b) => new Date(a.expiration).getTime() - new Date(b.expiration).getTime())
}

/**
 * Finds the "Zero Gamma" level for options expiring up to a specific date, which is the spot price 
 * at which the total net gamma exposure of options expiring on or before that date is estimated to be zero.
 *
 * If no specific expiration is provided, it filters options expiring within the next two months.
 * Then, it calculates the total net gamma exposure (Call GEX - Put GEX, using `calcGammaEx`)
 * across a range of spot price levels (from 80% to 120% of the current spot).
 * Linear interpolation is used between the two levels where the net gamma crosses zero
 * to estimate the precise Zero Gamma level.
 *
 * @param data - An array of `OptionData` objects.
 * @param spot - Current spot price of the underlying asset.
 * @param specificExpiry - Optional specific expiration date. If provided, includes all options expiring on or before this date.
 * @returns The estimated Zero Gamma level (spot price), or `null` if no zero crossing is found or in case of errors.
 */
export function findZeroGammaLevel(data: OptionData[], spot: number, specificExpiry?: Date): number | null {
  const today = new Date()
  let filteredData: OptionData[]

  if (specificExpiry) {
    // Filter for options expiring on or before the specific date (cumulative gamma effect)
    filteredData = data.filter((option) => 
      option.expiration <= specificExpiry
    )
  } else {
    // Default behavior: filter for options expiring within next 2 months
    const twoMonthsFromNow = new Date()
    twoMonthsFromNow.setDate(today.getDate() + 60)
    filteredData = data.filter((option) => option.expiration <= twoMonthsFromNow)
  }

  if (filteredData.length === 0) return null

  // Debug: Log how many options are being considered for the gamma flip calculation
  if (specificExpiry) {
    console.log(`Gamma flip calculation for ${specificExpiry.toISOString().split('T')[0]}: considering ${filteredData.length} options expiring on or before this date`)
  }

  // Calculate days till expiration for each option
  filteredData.forEach((option) => {
    const daysDiff = Math.ceil((option.expiration.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    // Handle 0DTE (same day expiration) and negative days (already expired)
    option.daysTillExp = Math.max(daysDiff, 0) === 0 ? 1 / 262 : Math.max(daysDiff, 1) / 262
  })

  // Use a wide and fine sweep
  const fromStrike = spot * 0.8
  const toStrike = spot * 1.2
  const levels = Array.from({ length: 30 }, (_, i) => fromStrike + ((toStrike - fromStrike) * i) / 29)
  const totalGamma: number[] = []

  // For each spot level, calculate gamma exposure
  levels.forEach((level) => {
    const callGamma = filteredData
      .filter((option) => option.type === "C")
      .reduce(
        (sum, option) =>
          sum + calcGammaEx(level, option.strike, option.iv, option.daysTillExp!, 0, 0, "call", option.open_interest),
        0,
      )

    const putGamma = filteredData
      .filter((option) => option.type === "P")
      .reduce(
        (sum, option) =>
          sum + calcGammaEx(level, option.strike, option.iv, option.daysTillExp!, 0, 0, "put", option.open_interest),
        0,
      )

    totalGamma.push((callGamma - putGamma) / 1e9)
  })

  // Find zero crossings
  const zeroCrossIndices: number[] = []
  for (let i = 0; i < totalGamma.length - 1; i++) {
    if (totalGamma[i] * totalGamma[i + 1] < 0) {
      zeroCrossIndices.push(i)
    }
  }

  if (zeroCrossIndices.length === 0) return null

  try {
    const idx = zeroCrossIndices[0]
    const negGamma = totalGamma[idx]
    const posGamma = totalGamma[idx + 1]
    const negStrike = levels[idx]
    const posStrike = levels[idx + 1]

    const gammaDiff = posGamma - negGamma
    if (Math.abs(gammaDiff) < 1e-8) {
      return (posStrike + negStrike) / 2
    }

    const zeroGamma = posStrike - ((posStrike - negStrike) * posGamma) / gammaDiff
    return zeroGamma
  } catch (error) {
    console.warn("Error calculating zero gamma level:", error)
    return null
  }
}

/**
 * Computes Call and Put "Walls" for a selected expiration date.
 * Walls are typically defined as strike prices with the highest open interest for calls and puts, respectively.
 *
 * It filters options for the `selectedExpiry` date, then aggregates total open interest by strike
 * for calls and puts separately. The strikes with the maximum OI are identified as the walls.
 *
 * @param data - An array of `OptionData` objects.
 * @param selectedExpiry - The specific expiration date for which to find the walls.
 * @returns A `CallPutWalls` object containing arrays of OI by strike for calls and puts,
 *          and the identified `callWall` and `putWall` strike prices.
 */
export function computeCallPutWalls(data: OptionData[], selectedExpiry: Date): CallPutWalls {
  const expiryData = data.filter((option) => option.expiration.toDateString() === selectedExpiry.toDateString())

  const calls = expiryData.filter((option) => option.type === "C")
  const puts = expiryData.filter((option) => option.type === "P")

  // Group by strike
  const callOIMap = new Map<number, number>()
  const putOIMap = new Map<number, number>()

  calls.forEach((option) => {
    const currentOI = callOIMap.get(option.strike) || 0
    callOIMap.set(option.strike, currentOI + option.open_interest)
  })

  puts.forEach((option) => {
    const currentOI = putOIMap.get(option.strike) || 0
    putOIMap.set(option.strike, currentOI + option.open_interest)
  })

  const callOI = Array.from(callOIMap.entries()).map(([strike, oi]) => ({ strike, oi }))
  const putOI = Array.from(putOIMap.entries()).map(([strike, oi]) => ({ strike, oi }))

  // Find walls (highest OI)
  const callWall =
    callOI.length > 0 ? callOI.reduce((max, current) => (current.oi > max.oi ? current : max)).strike : undefined
  const putWall =
    putOI.length > 0 ? putOI.reduce((max, current) => (current.oi > max.oi ? current : max)).strike : undefined

  return { callOI, putOI, callWall, putWall }
}

/**
 * Calculates the expected move for the underlying asset based on 16-delta strangles for various expirations.
 * The 16-delta call strike is used for the upper bound and the 16-delta put strike for the lower bound.
 *
 * It filters options up to one year out, or for a `selectedExpiry` if provided.
 * For each relevant expiration, it identifies the call option closest to 0.16 delta and
 * the put option closest to -0.16 delta. Their strikes define the expected range.
 * The move is also expressed as a percentage from the current `spotPrice`.
 *
 * @param data - An array of `OptionData` objects, which must include `delta` values.
 * @param spotPrice - Current spot price of the underlying asset.
 * @param selectedExpiry - Optional. If provided, calculates the expected move only for this expiration date.
 * @returns An array of `ExpectedMove` objects, each representing the expected range for an expiration date.
 */
export function calculateExpectedMove(data: OptionData[], spotPrice: number, selectedExpiry?: Date): ExpectedMove[] {
  const today = new Date()
  const oneYear = new Date()
  oneYear.setFullYear(today.getFullYear() + 1)

  let filteredData = data.filter((option) => option.expiration <= oneYear)

  if (selectedExpiry) {
    filteredData = data.filter((option) => option.expiration.toDateString() === selectedExpiry.toDateString())
  }

  const expiries = Array.from(new Set(filteredData.map((option) => option.expiration.getTime())))
    .map((time) => new Date(time))
    .sort((a, b) => a.getTime() - b.getTime())

  const results: ExpectedMove[] = []

  expiries.forEach((expiry) => {
    const expiryData = filteredData.filter((option) => option.expiration.toDateString() === expiry.toDateString())

    const calls = expiryData.filter((option) => option.type === "C")
    const puts = expiryData.filter((option) => option.type === "P")

    if (calls.length === 0 || puts.length === 0) return

    // Find 16-delta strikes
    const sixteenDeltaCall = calls.reduce((closest, current) =>
      Math.abs(current.delta - 0.16) < Math.abs(closest.delta - 0.16) ? current : closest,
    )

    const sixteenDeltaPut = puts.reduce((closest, current) =>
      Math.abs(current.delta - -0.16) < Math.abs(closest.delta - -0.16) ? current : closest,
    )

    const upper = sixteenDeltaCall.strike
    const lower = sixteenDeltaPut.strike
    const upperPct = ((upper - spotPrice) / spotPrice) * 100
    const lowerPct = ((lower - spotPrice) / spotPrice) * 100

    results.push({
      date: expiry,
      upper,
      lower,
      upperPct: Math.round(upperPct * 100) / 100,
      lowerPct: Math.round(lowerPct * 100) / 100,
    })
  })

  return results
}

/**
 * Computes actual trading Volume aggregated by strike price.
 * 
 * This function aggregates the actual trading volume (not open interest) for each strike price,
 * combining both calls and puts. Volume represents the number of contracts traded during
 * a specific time period (typically daily volume).
 *
 * @param data - An array of `OptionData` objects with volume data.
 * @returns An array of objects with strike and total volume, sorted by strike price.
 */
export function computeVolumeByStrike(data: OptionData[]): { strike: number; volume: number }[] {
  // Group by strike and sum volumes
  const volumeByStrike = new Map<number, number>()
  
  data.forEach((option) => {
    if (option.volume && option.volume > 0) {
      const currentVolume = volumeByStrike.get(option.strike) || 0
      volumeByStrike.set(option.strike, currentVolume + option.volume)
    }
  })

  // Convert to array and sort by strike
  const result: { strike: number; volume: number }[] = []
  volumeByStrike.forEach((volume, strike) => {
    result.push({ strike, volume })
  })

  return result.sort((a, b) => a.strike - b.strike)
}

/**
 * Calculates gamma flip levels for all available expiration dates using cumulative gamma exposure.
 * Each calculation includes all options expiring up to and including that expiration date.
 * Useful for comparing how gamma flip levels change as more expiries are included.
 * 
 * @param data - An array of `OptionData` objects.
 * @param spot - Current spot price of the underlying asset.
 * @returns An array of objects containing expiry date and corresponding cumulative gamma flip level.
 */
export function calculateGammaFlipByExpiry(data: OptionData[], spot: number): { expiry: Date; gammaFlip: number | null; daysToExpiry: number }[] {
  const today = new Date()
  const oneYearFromNow = new Date()
  oneYearFromNow.setFullYear(today.getFullYear() + 1)

  // Get unique expiry dates within the next year
  const expiries = Array.from(
    new Set(
      data
        .filter(option => option.expiration <= oneYearFromNow)
        .map(option => option.expiration.getTime())
    )
  )
  .map(time => new Date(time))
  .sort((a, b) => a.getTime() - b.getTime())

  return expiries.map(expiry => {
    const daysToExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    const gammaFlip = findZeroGammaLevel(data, spot, expiry)
    
    return {
      expiry,
      gammaFlip,
      daysToExpiry: Math.max(daysToExpiry, 0)
    }
  })
}
