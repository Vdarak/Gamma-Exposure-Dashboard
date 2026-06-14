import { NextResponse } from "next/server"

export async function GET() {
  try {
    const response = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/^IRX?interval=1d&range=1d", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    })
    
    if (response.ok) {
      const data = await response.json()
      const result = data?.chart?.result?.[0]
      const lastClose = result?.meta?.regularMarketPrice
      
      if (lastClose !== undefined && lastClose > 0) {
        return NextResponse.json({
          success: true,
          usRiskFreeRate: lastClose / 100,
          indiaRiskFreeRate: 0.065, // Standard India RBI repo rate benchmark
          source: `Yahoo Finance (^IRX: ${lastClose.toFixed(2)}%)`
        })
      }
    }
  } catch (err) {
    console.error("Error fetching dynamic US risk-free rate:", err)
  }
  
  // Fallback if Yahoo Finance is unreachable
  return NextResponse.json({
    success: false,
    usRiskFreeRate: 0.05, // 5% default assumed yield
    indiaRiskFreeRate: 0.065, // 6.5% default assumed yield
    source: "Assumed Defaults (Fallback)"
  })
}
