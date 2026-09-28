export const dynamic = "force-dynamic"
import { type NextRequest, NextResponse } from "next/server"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"

/**
 * Dedicated DhanHQ Options Inspection & Verification Route
 * Proxies requests to FastAPI backend DhanHQ endpoints so the user can verify
 * genuine real-time data directly from Dhan's servers.
 *
 * Query parameters:
 *   - ticker: NIFTY | BANKNIFTY | SENSEX (required)
 *   - expiry: YYYY-MM-DD (optional, defaults to nearest)
 *   - raw: true | false (optional, defaults to false)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const ticker = (searchParams.get("ticker") || "NIFTY").toUpperCase()
  const expiry = searchParams.get("expiry")
  const raw = searchParams.get("raw") === "true"

  try {
    let url = `${BACKEND_URL}/api/india/dhan/chain?ticker=${ticker}&raw=${raw}`
    if (expiry) {
      url += `&expiry=${encodeURIComponent(expiry)}`
    }

    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "Accept": "application/json"
      }
    })

    if (!response.ok) {
      const errText = await response.text()
      return NextResponse.json(
        { error: `Backend Dhan API returned ${response.status}: ${errText}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error: any) {
    console.error("Error proxying Dhan option chain request:", error)
    return NextResponse.json(
      {
        error: "Failed to connect to Dhan API backend",
        details: error?.message || String(error)
      },
      { status: 502 }
    )
  }
}
