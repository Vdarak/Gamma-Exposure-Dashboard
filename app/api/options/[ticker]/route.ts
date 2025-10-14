import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: tickerParam } = await params
  const ticker = tickerParam.toUpperCase()

  try {
    // Try with underscore prefix first
    let response = await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/_${ticker}.json`, {
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

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch data for ${ticker}. Status: ${response.status}` },
        { status: response.status },
      )
    }

    const rawData = await response.json()
    console.log(`Raw CBOE response structure for ${ticker}:`, Object.keys(rawData))

    // The CBOE API returns data in this format:
    // {
    //   "data": {
    //     "current_price": number,
    //     "options": array
    //   }
    // }
    // OR sometimes directly as:
    // {
    //   "current_price": number,
    //   "options": array
    // }

    let data = rawData

    // If data is nested under a "data" key, extract it
    if (rawData.data && typeof rawData.data === "object") {
      data = rawData.data
    }

    // Validate that we have the expected data structure
    if (!data.current_price && !data.price) {
      console.error(`Missing price data for ${ticker}. Available keys:`, Object.keys(data))
      return NextResponse.json(
        {
          error: `No price data available for ${ticker}. This ticker may not have options data on CBOE.`,
          debug: Object.keys(data),
        },
        { status: 400 },
      )
    }

    if (!data.options || !Array.isArray(data.options)) {
      console.error(`Missing or invalid options data for ${ticker}. Available keys:`, Object.keys(data))
      return NextResponse.json(
        {
          error: `No options data available for ${ticker}. This ticker may not have options listed on CBOE.`,
          debug: Object.keys(data),
        },
        { status: 400 },
      )
    }

    // Normalize the response format
    const normalizedData = {
      current_price: data.current_price || data.price,
      options: data.options,
      timestamp: new Date().toISOString(),
    }

    console.log(
      `Successfully fetched data for ${ticker}: ${normalizedData.options.length} options, price: ${normalizedData.current_price}`,
    )

    return NextResponse.json(normalizedData)
  } catch (error) {
    console.error(`Error fetching data for ${ticker}:`, error)
    return NextResponse.json(
      {
        error: `Unable to fetch data for ticker ${ticker}. Please check if the ticker is valid and has options listed on CBOE.`,
      },
      { status: 500 },
    )
  }
}
