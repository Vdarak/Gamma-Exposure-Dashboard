export const dynamic = "force-dynamic"
import { type NextRequest, NextResponse } from "next/server"

async function fetchEquityPriceFromYahoo(ticker: string): Promise<number | null> {
  try {
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Accept": "application/json",
      },
    })
    if (response.ok) {
      const data = await response.json()
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice
      if (typeof price === 'number') {
        return price
      }
    }
  } catch (error) {
    console.error(`Error fetching price from Yahoo for ${ticker}:`, error)
  }
  return null
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: tickerParam } = await params
  const ticker = tickerParam.toUpperCase()

  try {
    // Try CBOE first
    let response: Response | null = null
    try {
      response = await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/_${ticker}.json`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept: "application/json",
        },
      })

      if (!response.ok) {
        // Try without underscore prefix
        response = await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/${ticker}.json`, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            Accept: "application/json",
          },
        })
      }
    } catch (fetchError) {
      console.warn(`CBOE fetch threw error for ${ticker}:`, fetchError)
    }

    if (response && response.ok) {
      const rawData = await response.json()
      let data = rawData
      if (rawData.data && typeof rawData.data === "object") {
        data = rawData.data
      }

      if ((data.current_price || data.price) && data.options && Array.isArray(data.options)) {
        return NextResponse.json({
          current_price: data.current_price || data.price,
          options: data.options,
          timestamp: new Date().toISOString(),
        })
      }
    }

    // If CBOE failed or returned invalid data, fall back to Yahoo Finance
    console.log(`CBOE failed for ${ticker}. Falling back to Yahoo Finance...`)
    const yahooPrice = await fetchEquityPriceFromYahoo(ticker)
    if (yahooPrice !== null) {
      console.log(`Successfully fetched price from Yahoo for ${ticker}: ${yahooPrice}`)
      return NextResponse.json({
        current_price: yahooPrice,
        options: [],
        timestamp: new Date().toISOString(),
        fallback: true
      })
    }

    // If both failed, return a clean error
    return NextResponse.json(
      {
        error: `Unable to fetch data for ticker ${ticker}. Please check if the ticker is valid.`,
      },
      { status: 404 },
    )

  } catch (error) {
    console.error(`Error fetching data for ${ticker}:`, error)
    return NextResponse.json(
      {
        error: `Unable to fetch data for ticker ${ticker}. Please check if the ticker is valid.`,
      },
      { status: 500 },
    )
  }
}
