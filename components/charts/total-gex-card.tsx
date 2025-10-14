import { TrendingDown, TrendingUp, RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

interface TotalGEXCardProps {
  totalGEX: number
  ticker: string
  lastUpdated: Date | null
  onRefresh: () => void
  feedback?: { message: string; type: 'success' | 'error' } | null
}

export function TotalGEXCard({ totalGEX, ticker, lastUpdated, onRefresh, feedback }: TotalGEXCardProps) {
  const isNegative = totalGEX < 0
  const Icon = isNegative ? TrendingDown : TrendingUp
  const colorClass = isNegative ? "text-red-500" : "text-green-500"

  const formatTimestamp = (date: Date | null) => {
    if (!date) return "Loading..."
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  // Formats the data timestamp accounting for 15-minute delay
  const formatDelayedTimestamp = (date: Date | null) => {
    if (!date) return ""
    const delayed = new Date(date.getTime() - 15 * 60 * 1000)
    return delayed.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Total Notional GEX</CardTitle>
        <Icon className={`h-4 w-4 ${colorClass}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${colorClass}`}>${totalGEX.toFixed(4)} Bn</div>
        <p className="text-xs text-muted-foreground mt-2">
          {isNegative
            ? "Negative GEX suggests potential downward pressure"
            : "Positive GEX suggests potential upward pressure"}
        </p>
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/40">
          <p className="text-xs text-muted-foreground">
            Last updated: {formatTimestamp(lastUpdated)}
            {lastUpdated && (
              <span className="italic"> ({formatDelayedTimestamp(lastUpdated)})</span>
            )}
          </p>
          <div className="relative pl-10">
            {/* feedback pill slides in from left */}
            <span
              className={`absolute left-0 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full text-xs transition-all duration-300 ease-in-out ${
                feedback
                  ? 'translate-x-0 opacity-100'
                  : '-translate-x-4 opacity-0'
              } bg-green-500 text-[#2A3459]`}
            >
              {feedback?.message}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
              aria-label="Refresh data"
            >
              <RefreshCw size={14} />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
