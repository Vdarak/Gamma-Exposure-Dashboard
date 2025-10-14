# Free Price Chart Options for Time Machine

To complete the Time Machine feature with historical price charts, here are the best **FREE** options:

---

## 🏆 Recommended: TradingView Lightweight Charts

**Best for:** Professional-looking charts with excellent performance

### Why Choose This?
- ✅ **Free & Open Source**
- ✅ **Lightweight** (~45KB gzipped)
- ✅ **Beautiful** design matching your dark theme
- ✅ **High Performance** (handles millions of data points)
- ✅ **Zero API keys needed**
- ✅ **Built by TradingView** (industry standard)

### Installation
```bash
npm install lightweight-charts
```

### Integration Example
```typescript
"use client"

import { useEffect, useRef } from 'react'
import { createChart, ColorType } from 'lightweight-charts'

export function PriceChart({ data, currentPrice }) {
  const chartContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0A0E1A' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#2B2B43' },
        horzLines: { color: '#363C4E' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
    })

    const candlestickSeries = chart.addCandlestickSeries()
    candlestickSeries.setData(data)

    // Add current price line
    candlestickSeries.createPriceLine({
      price: currentPrice,
      color: '#2962FF',
      lineWidth: 2,
      lineStyle: 2,
      axisLabelVisible: true,
      title: 'current',
    })

    return () => chart.remove()
  }, [data, currentPrice])

  return <div ref={chartContainerRef} />
}
```

### Data Source Options (Free)
1. **Your Backend** - Store price snapshots alongside options
2. **Yahoo Finance** - `yfinance` Python library or API
3. **Alpha Vantage** - 25 requests/day free tier
4. **Twelve Data** - 800 requests/day free tier

---

## Option 2: Recharts + Data API

**Best for:** Simple integration with your existing React setup

### Why Choose This?
- ✅ **React-native** (JSX components)
- ✅ **Simple API**
- ✅ **Good documentation**
- ✅ **Responsive out of the box**

### Installation
```bash
npm install recharts
npm install axios
```

### Integration Example
```typescript
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

export function PriceChart({ ticker, timeRange }) {
  const [data, setData] = useState([])

  useEffect(() => {
    // Fetch from Alpha Vantage (free)
    fetch(`https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${ticker}&interval=5min&apikey=demo`)
      .then(res => res.json())
      .then(data => {
        // Transform data
        const formatted = Object.entries(data['Time Series (5min)']).map(([time, values]) => ({
          time,
          price: parseFloat(values['4. close'])
        }))
        setData(formatted)
      })
  }, [ticker])

  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={data}>
        <XAxis dataKey="time" stroke="#666" />
        <YAxis domain={['auto', 'auto']} stroke="#666" />
        <Tooltip 
          contentStyle={{ background: '#1a1a2e', border: '1px solid #333' }}
          labelStyle={{ color: '#fff' }}
        />
        <Line type="monotone" dataKey="price" stroke="#2962FF" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
```

---

## Option 3: Chart.js

**Best for:** Maximum flexibility and customization

### Why Choose This?
- ✅ **Highly customizable**
- ✅ **Popular** (11M+ downloads/week)
- ✅ **Good plugins** ecosystem
- ✅ **Canvas-based** (great performance)

### Installation
```bash
npm install chart.js react-chartjs-2
```

### Integration Example
```typescript
import { Line } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip } from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip)

export function PriceChart({ data }) {
  const chartData = {
    labels: data.map(d => d.time),
    datasets: [{
      label: 'Price',
      data: data.map(d => d.price),
      borderColor: '#2962FF',
      backgroundColor: 'rgba(41, 98, 255, 0.1)',
    }]
  }

  const options = {
    responsive: true,
    plugins: {
      legend: { display: false },
    },
    scales: {
      y: {
        ticks: { color: '#666' },
        grid: { color: '#333' }
      },
      x: {
        ticks: { color: '#666' },
        grid: { color: '#333' }
      }
    }
  }

  return <Line data={chartData} options={options} />
}
```

---

## Free Data Source APIs

### 1. **Alpha Vantage** (Recommended)
- **Free Tier**: 25 API requests/day
- **Data**: Real-time, intraday, daily, weekly, monthly
- **Sign up**: https://www.alphavantage.co/support/#api-key

```typescript
const API_KEY = 'your_free_api_key'
const url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${ticker}&interval=5min&apikey=${API_KEY}`
```

### 2. **Twelve Data**
- **Free Tier**: 800 API requests/day
- **Data**: Real-time, historical, crypto, forex
- **Sign up**: https://twelvedata.com/

```typescript
const API_KEY = 'your_free_api_key'
const url = `https://api.twelvedata.com/time_series?symbol=${ticker}&interval=5min&apikey=${API_KEY}`
```

### 3. **Yahoo Finance (Unofficial)**
- **Free Tier**: Unlimited (use responsibly)
- **Data**: Historical, real-time-ish (15min delay)
- **Library**: `yahoo-finance2` (Node.js)

```typescript
import yahooFinance from 'yahoo-finance2'

const result = await yahooFinance.historical(ticker, {
  period1: '2024-01-01',
  interval: '5m'
})
```

### 4. **Your Own Backend** (Best Option!)
- Store price alongside option snapshots
- No external API limits
- Full control over data

---

## 🎯 Recommended Setup

### Phase 1: Simple Integration (1 hour)
1. Install **TradingView Lightweight Charts**
2. Use **Alpha Vantage** free API
3. Cache data in your backend database

### Phase 2: Production Setup (Later)
1. Store price data in your backend during cron jobs
2. Serve from your own API
3. No external dependencies!

---

## Example: Complete Integration

```typescript
// components/price-chart.tsx
"use client"

import { useEffect, useRef } from 'react'
import { createChart, ColorType } from 'lightweight-charts'

interface PriceChartProps {
  ticker: string
  timestamp: Date | null
  spotPrice: number
}

export function PriceChart({ ticker, timestamp, spotPrice }: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0A0E1A' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#2B2B43' },
        horzLines: { color: '#363C4E' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
    })

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })

    // Fetch historical data
    fetchPriceData(ticker, timestamp).then(data => {
      candlestickSeries.setData(data)
    })

    // Add current price line
    if (spotPrice > 0) {
      candlestickSeries.createPriceLine({
        price: spotPrice,
        color: '#2962FF',
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Spot',
      })
    }

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ 
          width: chartContainerRef.current.clientWidth 
        })
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [ticker, timestamp, spotPrice])

  return <div ref={chartContainerRef} />
}

async function fetchPriceData(ticker: string, timestamp: Date | null) {
  // Fetch from your backend or Alpha Vantage
  const response = await fetch(`/api/price-history?ticker=${ticker}`)
  const data = await response.json()
  
  // Transform to TradingView format
  return data.map((item: any) => ({
    time: item.time,
    open: item.open,
    high: item.high,
    low: item.low,
    close: item.close,
  }))
}
```

---

## Cost Comparison

| Solution | Cost | Rate Limit | Best For |
|----------|------|------------|----------|
| **TradingView Charts + Alpha Vantage** | FREE | 25/day | Quick start |
| **TradingView Charts + Twelve Data** | FREE | 800/day | More requests |
| **TradingView Charts + Your Backend** | FREE | Unlimited | Production |
| **Paid Solutions (not needed!)** | $$ | - | Enterprise |

---

## Next Steps

1. **Choose**: TradingView Lightweight Charts ✅
2. **Install**: `npm install lightweight-charts`
3. **Integrate**: Replace "Coming Soon" div in enhanced-time-machine.tsx
4. **Data Source**: Start with Alpha Vantage, migrate to your backend later
5. **Deploy**: Charts work on Vercel automatically!

---

## 💡 Pro Tips

- **Cache data**: Store price data in your backend to avoid API limits
- **Align strikes**: Ensure Y-axis range matches your GEX chart
- **Loading states**: Show skeleton while data loads
- **Error handling**: Graceful fallback if API fails
- **Mobile**: TradingView charts are responsive by default

---

## Resources

- TradingView Charts: https://tradingview.github.io/lightweight-charts/
- Alpha Vantage: https://www.alphavantage.co/documentation/
- Twelve Data: https://twelvedata.com/docs
- Chart.js: https://www.chartjs.org/docs/

**Estimated Time**: 1-2 hours to fully integrate! 🚀
