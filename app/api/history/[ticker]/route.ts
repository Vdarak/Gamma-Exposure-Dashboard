export const dynamic = "force-dynamic"
import { type NextRequest, NextResponse } from "next/server"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: rawTicker } = await params
  let ticker = rawTicker.toUpperCase()

  // Map to Yahoo Finance symbols
  if (ticker === 'SPX') ticker = '^SPX'
  else if (ticker === 'NIFTY') ticker = '^NSEI'
  else if (ticker === 'BANKNIFTY') ticker = '^NSEBANK'

  const { searchParams } = new URL(request.url)
  const timeframe = searchParams.get('timeframe') || '1D'

  // Map timeframe to Yahoo parameters
  let interval = '1d'
  let range = '3mo'

  if (timeframe === '1m') {
    interval = '1m'
    range = '1d'
  } else if (timeframe === '5m') {
    interval = '5m'
    range = '5d'
  } else if (timeframe === '15m') {
    interval = '15m'
    range = '5d'
  } else if (timeframe === '1D') {
    interval = '1d'
    range = '3mo'
  } else if (timeframe === '1W') {
    interval = '1wk'
    range = '1y'
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}`
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    })

    if (!response.ok) {
      return NextResponse.json({ error: `Yahoo Finance API returned status ${response.status}` }, { status: response.status })
    }

    const data = await response.json()
    const result = data?.chart?.result?.[0]

    if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
      return NextResponse.json({ error: 'No chart data available from Yahoo Finance' }, { status: 404 })
    }

    const timestamps = result.timestamp as number[]
    const quote = result.indicators.quote[0]
    const opens = quote.open as (number | null)[]
    const highs = quote.high as (number | null)[]
    const lows = quote.low as (number | null)[]
    const closes = quote.close as (number | null)[]
    const volumes = quote.volume as (number | null)[]

    const candles = timestamps.map((t, idx) => {
      const date = new Date(t * 1000)
      
      let dateStr = ''
      if (timeframe.endsWith('m')) {
        dateStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      } else {
        dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' })
      }

      return {
        date: dateStr,
        timestamp: t * 1000,
        open: opens[idx] || closes[idx] || 0,
        high: highs[idx] || closes[idx] || 0,
        low: lows[idx] || closes[idx] || 0,
        close: closes[idx] || 0,
        volume: volumes[idx] || 0,
      }
    }).filter(c => c.close > 0) // filter out invalid/empty candles

    return NextResponse.json({ success: true, candles })
  } catch (err) {
    console.error('Error fetching historical candles:', err)
    return NextResponse.json({ error: 'Failed to fetch historical data' }, { status: 500 })
  }
}
