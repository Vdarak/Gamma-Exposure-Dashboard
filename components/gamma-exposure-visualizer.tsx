"use client"

import type React from "react"

import { useState } from "react"
import { BarChart, LineChart, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GexByStrike } from "@/components/charts/gex-by-strike"
import { GexByExpiration } from "@/components/charts/gex-by-expiration"
import { GexSurface } from "@/components/charts/gex-surface"
import { TotalGex } from "@/components/total-gex"

export function GammaExposureVisualizer() {
  const [ticker, setTicker] = useState("SPX")
  const [isLoading, setIsLoading] = useState(false)
  const [hasData, setHasData] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!ticker) return

    setIsLoading(true)

    // Simulate data loading
    setTimeout(() => {
      setIsLoading(false)
      setHasData(true)
    }, 1500)
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Enter Ticker Symbol</CardTitle>
          <CardDescription>Enter a ticker symbol to fetch gamma exposure data from CBOE.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex w-full max-w-sm items-center space-x-2">
            <Input
              type="text"
              placeholder="e.g. SPX, AAPL, TSLA"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              disabled={isLoading}
            />
            <Button type="submit" disabled={isLoading || !ticker}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading
                </>
              ) : (
                "Fetch Data"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {hasData && (
        <>
          <TotalGex ticker={ticker} />

          <Tabs defaultValue="strike">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="strike">GEX by Strike</TabsTrigger>
              <TabsTrigger value="expiration">GEX by Expiration</TabsTrigger>
              <TabsTrigger value="surface">GEX Surface</TabsTrigger>
            </TabsList>
            <TabsContent value="strike">
              <Card>
                <CardHeader>
                  <CardTitle>Gamma Exposure by Strike Price</CardTitle>
                  <CardDescription>
                    Visualizes gamma exposure distribution across different strike prices.
                  </CardDescription>
                </CardHeader>
                <CardContent className="h-[400px]">
                  <GexByStrike ticker={ticker} />
                </CardContent>
                <CardFooter className="text-sm text-muted-foreground">
                  <BarChart className="mr-1 h-4 w-4" />
                  Data limited to ±15% from spot price.
                </CardFooter>
              </Card>
            </TabsContent>
            <TabsContent value="expiration">
              <Card>
                <CardHeader>
                  <CardTitle>Gamma Exposure by Expiration Date</CardTitle>
                  <CardDescription>
                    Shows gamma exposure distribution across different expiration dates.
                  </CardDescription>
                </CardHeader>
                <CardContent className="h-[400px]">
                  <GexByExpiration ticker={ticker} />
                </CardContent>
                <CardFooter className="text-sm text-muted-foreground">
                  <BarChart className="mr-1 h-4 w-4" />
                  Data limited to one year from today.
                </CardFooter>
              </Card>
            </TabsContent>
            <TabsContent value="surface">
              <Card>
                <CardHeader>
                  <CardTitle>Gamma Exposure 3D Surface</CardTitle>
                  <CardDescription>
                    3D visualization of gamma exposure across both strike prices and expiration dates.
                  </CardDescription>
                </CardHeader>
                <CardContent className="h-[500px]">
                  <GexSurface ticker={ticker} />
                </CardContent>
                <CardFooter className="text-sm text-muted-foreground">
                  <LineChart className="mr-1 h-4 w-4" />
                  Data limited to ±15% from spot price and one year expiration.
                </CardFooter>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
