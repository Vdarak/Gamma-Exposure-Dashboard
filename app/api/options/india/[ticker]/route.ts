import { type NextRequest, NextResponse } from "next/server"

// Helper function to determine if symbol is an index or equity
function isIndexSymbol(symbol: string): boolean {
  const indices = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50']
  return indices.some(index => symbol.toUpperCase().includes(index.toUpperCase()))
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: tickerParam } = await params
  const ticker = tickerParam.toUpperCase()

  try {
    // First approach: Try alternative NSE data sources
    let optionsData: any[] = []
    let currentPrice: number | null = null
    
    // Try to get current price from multiple sources
    currentPrice = await getCurrentPrice(ticker)
    
    // Try to get options data from NSE
    optionsData = await getNSEOptionsData(ticker)

    const normalizedData = {
      current_price: currentPrice,
      options: optionsData,
      timestamp: new Date().toISOString(),
      market: "INDIA",
      exchange: "NSE",
      data_source: "NSE_API"
    }

    console.log(
      `Successfully fetched Indian market data for ${ticker}: ${normalizedData.options.length} options, price: ₹${normalizedData.current_price}`,
    )

    return NextResponse.json(normalizedData)
  } catch (error) {
    console.error(`Error fetching Indian market data for ${ticker}:`, error)
    return NextResponse.json(
      {
        error: `Unable to fetch Indian market data for ticker ${ticker}. Please check if the ticker is valid for NSE.`,
      },
      { status: 500 },
    )
  }
}

// Function to get current price from multiple sources
async function getCurrentPrice(ticker: string): Promise<number | null> {
  const isIndex = isIndexSymbol(ticker)
  
  let sources: string[] = []
  
  if (isIndex) {
    // For indices, use different Yahoo Finance symbols
    const indexSymbols: { [key: string]: string } = {
      'NIFTY': '^NSEI',
      'BANKNIFTY': '^NSEBANK',
      'FINNIFTY': '^NSEFIN',
      'MIDCPNIFTY': '^NSEMIDCP',
      'NIFTYNXT50': '^NSENEXT50'
    }
    
    const yahooSymbol = indexSymbols[ticker.toUpperCase()] || `^NSE${ticker}`
    sources = [
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}`,
      // Fallback with direct NSE symbol
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.NS`,
    ]
  } else {
    // For stocks, use .NS suffix
    sources = [
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.NS`,
      // Alternative without suffix in case it's needed
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`,
    ]
  }

  for (const source of sources) {
    try {
      const response = await fetch(source, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json",
        },
      })

      if (response.ok) {
        const data = await response.json()
        
        // Yahoo Finance format
        if (data?.chart?.result?.[0]?.meta?.regularMarketPrice) {
          console.log(`Successfully fetched price for ${ticker} from ${source}: ${data.chart.result[0].meta.regularMarketPrice}`)
          return data.chart.result[0].meta.regularMarketPrice
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch price from ${source}:`, error)
      continue
    }
  }

  throw new Error(`Unable to fetch current price for ${ticker}`)
}

// Function to get NSE options data with proper cookie session management
async function getNSEOptionsData(ticker: string): Promise<any[]> {
  try {
    // Determine if it's an index or equity
    const isIndex = isIndexSymbol(ticker)
    
    // Step 1: Hit the option-chain page to get cookies
    console.log(`Step 1: Getting cookies from NSE option-chain page for ${ticker}`)
    
    const optionChainHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate", 
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      "Connection": "keep-alive",
    }

    // Add timeout and better error handling for Vercel deployment
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout

    try {
      // First, visit the option-chain page to establish session and get cookies
      const optionChainResponse = await fetch("https://www.nseindia.com/option-chain", {
        headers: optionChainHeaders,
        method: 'GET',
        signal: controller.signal,
        // Add additional fetch options for better compatibility
        redirect: 'follow',
        referrerPolicy: 'no-referrer-when-downgrade',
      })

      clearTimeout(timeoutId)
      console.log(`NSE option-chain page response: ${optionChainResponse.status}`)
      
      if (!optionChainResponse.ok) {
        throw new Error(`Option chain page returned ${optionChainResponse.status}`)
      }
      
      // Extract cookies from the response
      const setCookieHeaders = optionChainResponse.headers.getSetCookie()
      const cookies = setCookieHeaders.join('; ')
      
      console.log(`Extracted cookies: ${cookies.substring(0, 100)}...`)
      
      if (!cookies || cookies.length < 10) {
        throw new Error('No valid cookies received from NSE')
      }
      
      // Step 2: Now use the cookies to hit the actual API
      const apiEndpoint = isIndex 
        ? `https://www.nseindia.com/api/option-chain-indices?symbol=${ticker}`
        : `https://www.nseindia.com/api/option-chain-equities?symbol=${ticker}`

      console.log(`Step 2: Fetching NSE options data from: ${apiEndpoint}`)

      const apiHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": "https://www.nseindia.com/option-chain",
        "Origin": "https://www.nseindia.com",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "X-Requested-With": "XMLHttpRequest",
        "Cookie": cookies,
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Connection": "keep-alive",
      }

      const controller2 = new AbortController()
      const timeoutId2 = setTimeout(() => controller2.abort(), 15000) // 15 second timeout

      const response = await fetch(apiEndpoint, {
        headers: apiHeaders,
        method: 'GET',
        signal: controller2.signal,
        redirect: 'follow',
        referrerPolicy: 'no-referrer-when-downgrade',
      })

      clearTimeout(timeoutId2)
      console.log(`NSE API response status: ${response.status}`)

      if (response.ok) {
        const nseData = await response.json()
        console.log(`NSE API response received, parsing data for ${ticker}`)
        const parsedOptions = parseNSEOptionsData(nseData, ticker)
        console.log(`Parsed ${parsedOptions.length} options for ${ticker}`)
        return parsedOptions
      } else {
        const errorText = await response.text()
        console.error(`NSE API failed with status: ${response.status}, response: ${errorText}`)
        throw new Error(`NSE API returned status ${response.status}: ${errorText}`)
      }
    } catch (fetchError) {
      clearTimeout(timeoutId)
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        throw new Error('NSE API request timed out - this may be due to Vercel deployment restrictions')
      }
      throw fetchError
    }
  } catch (error) {
    console.error('Error fetching NSE options data:', error)
    
    // Enhanced error message for Vercel deployment issues
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (errorMessage.includes('fetch failed') || errorMessage.includes('network')) {
      throw new Error(`NSE API is blocked on this deployment platform. This works locally but Vercel's infrastructure may be blocked by NSE. Consider using a different deployment platform or NSE data provider. Original error: ${errorMessage}`)
    }
    
    throw new Error(`Failed to fetch options data from NSE: ${errorMessage}`)
  }
}

// Function to parse NSE API response into our expected format
function parseNSEOptionsData(nseData: any, ticker: string): any[] {
  const options: any[] = []
  
  try {
    // NSE API returns data in records.data array
    const records = nseData?.records?.data || []
    
    for (const record of records) {
      const strikePrice = record.strikePrice
      const expiryDate = record.expiryDate
      
      // Parse Call options
      if (record.CE) {
        const callOption = record.CE
        options.push({
          strike: strikePrice,
          expiration: new Date(expiryDate).toISOString(),
          type: 'C',
          iv: callOption.impliedVolatility || 0,
          gamma: callOption.gamma || 0,
          open_interest: callOption.openInterest || 0,
          volume: callOption.totalTradedVolume || 0,
          bid: callOption.bidprice || 0,
          ask: callOption.askPrice || 0,
          last: callOption.lastPrice || 0,
          change: callOption.change || 0,
          percent_change: callOption.pChange || 0,
        })
      }
      
      // Parse Put options
      if (record.PE) {
        const putOption = record.PE
        options.push({
          strike: strikePrice,
          expiration: new Date(expiryDate).toISOString(),
          type: 'P',
          iv: putOption.impliedVolatility || 0,
          gamma: putOption.gamma || 0,
          open_interest: putOption.openInterest || 0,
          volume: putOption.totalTradedVolume || 0,
          bid: putOption.bidprice || 0,
          ask: putOption.askPrice || 0,
          last: putOption.lastPrice || 0,
          change: putOption.change || 0,
          percent_change: putOption.pChange || 0,
        })
      }
    }
    
    return options
  } catch (parseError) {
    console.error('Error parsing NSE data:', parseError)
    return []
  }
}