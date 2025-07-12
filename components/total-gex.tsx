import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface TotalGexProps {
  ticker: string
}

export function TotalGex({ ticker }: TotalGexProps) {
  // In a real implementation, this would fetch the actual data
  const totalGex = -38.1193 // Example value from the README
  const gexColor = totalGex < 0 ? "text-red-500" : "text-green-500"

  return (
    <Card>
      <CardHeader>
        <CardTitle>Total Notional Gamma Exposure</CardTitle>
        <CardDescription>Total dealers' gamma exposure for {ticker}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-center">
          <span className={`text-4xl font-bold ${gexColor}`}>${totalGex.toFixed(4)} Bn</span>
          <p className="mt-2 text-sm text-muted-foreground">
            Negative GEX suggests potential downward pressure on price, while positive GEX suggests potential upward
            pressure.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
