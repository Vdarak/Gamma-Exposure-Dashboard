"use client"

/**
 * Example Integration: How to use the Time Machine with your existing dashboard
 * 
 * This file shows how to integrate the Time Machine component with your
 * GEX visualization components to enable time-travel functionality.
 */

import { useState, useEffect } from 'react'
import { TimeMachine } from '@/components/time-machine'
import { GammaExposureDashboard } from '@/components/gamma-exposure-dashboard'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'

export default function DashboardWithTimeMachine() {
  const [ticker, setTicker] = useState('SPX')
  const [selectedTimestamp, setSelectedTimestamp] = useState<Date | null>(null)
  const [optionData, setOptionData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch data whenever ticker or timestamp changes
  useEffect(() => {
    fetchData()
  }, [ticker, selectedTimestamp])

  async function fetchData() {
    setLoading(true)
    setError(null)

    try {
      let url: string

      if (selectedTimestamp) {
        // Historical data - fetch from backend
        url = `${BACKEND_URL}/api/historical-data?ticker=${ticker}&timestamp=${selectedTimestamp.toISOString()}`
      } else {
        // Live data - you can choose:
        // Option 1: Fetch from backend (most recent snapshot)
        url = `${BACKEND_URL}/api/current-data?ticker=${ticker}`
        
        // Option 2: Fetch directly from your existing API route for real-time data
        // url = `/api/options/${ticker}`
      }

      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const result = await response.json()

      // Handle response format
      let data
      if (selectedTimestamp) {
        // Backend historical data format
        data = result.data?.[0] || result.data
      } else {
        // Backend current data format
        data = result.data
      }

      // Normalize data structure
      if (data) {
        setOptionData({
          current_price: data.spotPrice,
          options: data.options,
          timestamp: data.timestamp,
        })
      }
    } catch (err) {
      console.error('Error fetching data:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0E1A] text-white p-6 space-y-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Gamma Exposure Dashboard</h1>
          <p className="text-gray-400">
            Real-time and historical options flow analysis
          </p>
        </div>

        {/* Ticker Selection */}
        <div className="mb-4">
          <Tabs value={ticker} onValueChange={setTicker}>
            <TabsList className="bg-[#181C2A]">
              <TabsTrigger value="SPX">SPX</TabsTrigger>
              <TabsTrigger value="QQQ">QQQ</TabsTrigger>
              <TabsTrigger value="NDX">NDX</TabsTrigger>
              <TabsTrigger value="RUT">RUT</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Time Machine Component */}
        <TimeMachine
          ticker={ticker}
          onTimestampChange={setSelectedTimestamp}
          backendUrl={BACKEND_URL}
        />

        {/* Loading State */}
        {loading && (
          <div className="bg-[#181C2A] rounded-lg p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-400">Loading data...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-900/20 border border-red-500 rounded-lg p-4 text-red-400">
            <p className="font-semibold">Error loading data</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Dashboard Content */}
        {!loading && !error && optionData && (
          <>
            {/* Status Badge */}
            <div className="mb-4 flex items-center gap-2">
              {selectedTimestamp ? (
                <div className="bg-blue-900/30 border border-blue-500 rounded-full px-4 py-2 text-sm">
                  📅 Historical Data: {selectedTimestamp.toLocaleString()}
                </div>
              ) : (
                <div className="bg-green-900/30 border border-green-500 rounded-full px-4 py-2 text-sm flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400"></span>
                  </span>
                  Live Data
                </div>
              )}
            </div>

            {/* Your existing dashboard component */}
            <GammaExposureDashboard
              ticker={ticker}
              data={optionData}
              isHistorical={!!selectedTimestamp}
            />
          </>
        )}

        {/* Info Card */}
        <div className="mt-6 bg-[#181C2A] border border-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            💡 How to Use Time Machine
          </h3>
          <ul className="space-y-2 text-sm text-gray-400">
            <li>• <strong>Live Mode:</strong> Shows real-time data from the latest snapshot</li>
            <li>• <strong>Historical Mode:</strong> Drag the slider to view past data</li>
            <li>• <strong>Play Button:</strong> Automatically play through time to see data evolution</li>
            <li>• <strong>Go Live:</strong> Jump back to real-time data</li>
            <li>• <strong>Data Collection:</strong> Backend collects data every 15 minutes automatically</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

/**
 * Alternative: Minimal Integration
 * 
 * If you just want to add Time Machine to your existing page.tsx:
 */

/*
import { TimeMachine } from '@/components/time-machine'

export default function YourExistingPage() {
  const [selectedTimestamp, setSelectedTimestamp] = useState<Date | null>(null)
  
  // Add this before your existing components
  return (
    <div>
      <TimeMachine
        ticker="SPX"
        onTimestampChange={setSelectedTimestamp}
        backendUrl={process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}
      />
      
      {/* Your existing components *\/}
    </div>
  )
}
*/

/**
 * Environment Variables
 * 
 * Add to your .env.local:
 * NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
 * 
 * For production:
 * NEXT_PUBLIC_BACKEND_URL=https://your-backend.up.railway.app
 */
