"use client"

import { useState, useMemo, useEffect } from "react"
import { useRouter } from "next/navigation"
import type { OptionData } from "@/lib/types"
import { GEXByStrikeChart } from "@/components/charts/gex-by-strike-chart"
import { 
  Sparkles, 
  Terminal, 
  ArrowRight, 
  Lock, 
  Mail, 
  Check, 
  Activity, 
  TrendingUp, 
  Layers, 
  Globe, 
  Zap, 
  BookOpen,
  DollarSign,
  ShieldCheck,
  ChevronRight
} from "lucide-react"

// Mock Option Chain Generator for SPX Preview
function generateMockOptionData(spot: number): OptionData[] {
  const data: OptionData[] = []
  const strikes: number[] = []
  const expiry = new Date()
  expiry.setHours(0, 0, 0, 0)
  
  const baseStrike = Math.round(spot / 5) * 5
  for (let i = -12; i <= 12; i++) {
    strikes.push(baseStrike + i * 5)
  }

  strikes.forEach(strike => {
    const dist = (strike - spot) / spot
    
    // Calls
    const callIv = 12.5 + dist * 45 + Math.random() * 1.5
    const callOi = Math.round(Math.max(200, (1 - Math.abs(dist) * 12) * 4500))
    const callVol = Math.round(callOi * (0.15 + Math.random() * 0.35))
    const callDelta = Math.max(0.01, Math.min(0.99, 0.5 - dist * 8))
    const callGamma = Math.max(0.0001, 0.008 * Math.exp(-dist * dist * 280))
    
    data.push({
      option: `SPX260622C0${strike}000`,
      type: 'C',
      strike,
      expiration: expiry,
      gamma: callGamma,
      open_interest: callOi,
      volume: callVol,
      iv: callIv,
      delta: callDelta,
      bid: strike > spot ? 1.5 : (spot - strike) + 2,
      ask: strike > spot ? 1.7 : (spot - strike) + 2.2,
      last: strike > spot ? 1.6 : (spot - strike) + 2.1,
    })

    // Puts
    const putIv = 13.5 - dist * 35 + Math.random() * 1.5
    const putOi = Math.round(Math.max(200, (1 - Math.abs(dist) * 12) * 5500))
    const putVol = Math.round(putOi * (0.2 + Math.random() * 0.5))
    const putDelta = Math.max(-0.99, Math.min(-0.01, -0.5 - dist * 8))
    const putGamma = Math.max(0.0001, 0.008 * Math.exp(-dist * dist * 240))
    
    data.push({
      option: `SPX260622P0${strike}000`,
      type: 'P',
      strike,
      expiration: expiry,
      gamma: putGamma,
      open_interest: putOi,
      volume: putVol,
      iv: putIv,
      delta: putDelta,
      bid: strike < spot ? 1.4 : (strike - spot) + 1.9,
      ask: strike < spot ? 1.6 : (strike - spot) + 2.1,
      last: strike < spot ? 1.5 : (strike - spot) + 2.0,
    })
  })

  return data
}

export function LandingPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [selectedTier, setSelectedTier] = useState<"Free" | "Pro" | "Lifetime">("Pro")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [signupSuccess, setSignupSuccess] = useState(false)
  const [waitlistNumber, setWaitlistNumber] = useState(0)
  const [pricingMethod, setPricingMethod] = useState<"black-scholes" | "binomial">("black-scholes")
  
  // Interactive preview state
  const spotPrice = 5425
  const mockOptionChain = useMemo(() => generateMockOptionData(spotPrice), [])
  const expiries = useMemo(() => [new Date().toISOString().split("T")[0]], [])

  // Simulated live trade ideas feed
  const [liveIdeas, setLiveIdeas] = useState([
    { ticker: "SPX", type: "neutral_pin", title: "SPX 0DTE Pin Settlebomb", strike: 5430, prob: "88%", time: "Active" },
    { ticker: "TSLA", type: "bullish_squeeze", title: "TSLA Short Squeeze Settlebomb", strike: 185, prob: "74%", time: "2 min ago" },
  ])

  useEffect(() => {
    // Periodically fluctuate spot slightly and regenerate ideas for "live" feel
    const interval = setInterval(() => {
      setLiveIdeas(prev => {
        const copy = [...prev]
        // Randomly update the probability slightly
        copy[0].prob = `${Math.floor(82 + Math.random() * 12)}%`
        return copy
      })
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleSubmitWaitlist = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !email.includes("@")) return

    setIsSubmitting(true)
    try {
      if (selectedTier === "Free") {
        // Free waitlist flow
        const res = await fetch("/api/waitlist/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, tier: "Free" }),
        })
        const result = await res.json()
        if (result.success) {
          setSignupSuccess(true)
          setWaitlistNumber(Math.floor(12400 + Math.random() * 850))
        }
      } else {
        // Paid billing pre-order flow
        const res = await fetch("/api/billing/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, tier: selectedTier }),
        })
        const result = await res.json()
        if (result.success && result.checkoutUrl) {
          // Redirect to checkout url (Stripe or Simulation)
          window.location.href = result.checkoutUrl
        }
      }
    } catch (err) {
      console.error("Waitlist error:", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#020203] text-white flex flex-col font-sans relative overflow-hidden select-none">
      
      {/* Background Mesh Gradients */}
      <div className="absolute top-[-10%] left-[-20%] w-[80%] h-[70%] bg-blue-900/10 rounded-full blur-[160px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-[#ff3366]/5 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-[30%] right-[10%] w-[40%] h-[40%] bg-emerald-900/10 rounded-full blur-[150px] pointer-events-none" />

      {/* Grid Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />

      {/* Header */}
      <header className="border-b border-white/5 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex justify-between items-center max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Terminal className="w-4 h-4 text-black font-black" />
          </div>
          <span className="font-bold text-sm tracking-wider font-mono bg-gradient-to-r from-white via-white/90 to-white/50 bg-clip-text text-transparent">
            GAMMAEX.IO
          </span>
        </div>

        <div className="flex items-center gap-4">
          <a href="#features" className="text-xs text-white/60 hover:text-white transition-all font-mono">FEATURES</a>
          <a href="#pricing" className="text-xs text-white/60 hover:text-white transition-all font-mono">PRICING</a>
          <button 
            onClick={() => router.push("/dashboard")}
            className="px-3.5 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all rounded text-xs font-mono flex items-center gap-1.5"
          >
            LAUNCH DEMO <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col gap-24 py-16 px-6 max-w-7xl mx-auto w-full z-10">
        
        {/* HERO SECTION */}
        <section className="text-center flex flex-col items-center max-w-3xl mx-auto gap-6 mt-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[10px] font-mono tracking-wider uppercase animate-pulse">
            <Sparkles className="w-3.5 h-3.5" />
            0DTE SETTLEBOMB PINNING ENGINE ACTIVE
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-none bg-gradient-to-b from-white via-white to-white/60 bg-clip-text text-transparent">
            Unify Option Gamma. <br />
            Stack Settlebomb Signals.
          </h1>

          <p className="text-sm sm:text-base text-white/50 leading-relaxed font-mono max-w-xl">
            A premium real-time option terminal mapping Call/Put walls, GARCH volatility, and quantum tunneling probability to pinpoint exact 0DTE settlement pins.
          </p>

          <form onSubmit={handleSubmitWaitlist} className="w-full max-w-md flex flex-col gap-3 mt-4">
            <div className="relative flex items-center">
              <Mail className="absolute left-3.5 w-4 h-4 text-white/30" />
              <input
                type="email"
                placeholder="Enter your institutional email..."
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded focus:outline-none focus:border-emerald-500/50 transition-all text-sm font-mono placeholder:text-white/25"
              />
            </div>
            
            <div className="flex gap-2 justify-center font-mono">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-black font-black rounded text-sm transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20"
              >
                {isSubmitting ? "PROCESSING PRE-ORDER..." : selectedTier === "Free" ? "JOIN THE WAITLIST" : `BYPASS QUEUE & PRE-ORDER ${selectedTier.toUpperCase()}`}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {signupSuccess && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded text-center">
                <p className="text-xs font-mono text-emerald-400 font-bold">
                  SUCCESS! You are waitlist candidate #{waitlistNumber}. We will email you once access opens.
                </p>
              </div>
            )}
          </form>
        </section>

        {/* INTERACTIVE PREVIEW WIDGET */}
        <section id="demo" className="w-full flex flex-col gap-6">
          <div className="text-center">
            <h2 className="text-xs font-bold text-emerald-400 font-mono tracking-widest uppercase">INTERACTIVE SANDBOX</h2>
            <p className="text-xl font-bold mt-1 text-white">Institutional Terminal Preview</p>
          </div>

          <div className="glass-panel border border-white/5 rounded-xl overflow-hidden shadow-2xl bg-black/60 backdrop-blur-md grid grid-cols-1 lg:grid-cols-4">
            {/* Live Signal Feed Panel */}
            <div className="lg:col-span-1 border-r border-white/5 p-5 flex flex-col gap-4 font-mono">
              <div className="flex justify-between items-center pb-3 border-b border-white/5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                  LIVE SETTLEBOMBS
                </span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              </div>

              <div className="flex-1 flex flex-col gap-3">
                {liveIdeas.map((idea, idx) => (
                  <div key={idx} className="bg-white/5 hover:bg-white/10 transition-all border border-white/5 rounded p-3 flex flex-col gap-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-bold border border-emerald-500/20">
                        {idea.ticker} 0DTE
                      </span>
                      <span className="text-[9px] text-white/40">{idea.time}</span>
                    </div>
                    <span className="text-xs font-bold text-white leading-tight">{idea.title}</span>
                    <div className="flex justify-between items-center text-[10px] text-white/50 mt-1">
                      <span>Target strike: <strong className="text-white">${idea.strike}</strong></span>
                      <span className="text-emerald-400 font-bold">{idea.prob} Pin Prob</span>
                    </div>
                  </div>
                ))}

                <div className="bg-blue-500/5 border border-blue-500/15 rounded p-3 flex flex-col gap-1.5 mt-auto">
                  <span className="text-[9px] text-blue-400 uppercase font-bold tracking-wider">Quant Alignment</span>
                  <p className="text-[10px] text-white/60 leading-relaxed">
                    Dealer short gamma is compressing. Proximity to Call Wall (5450) is sparking breakout vectors.
                  </p>
                </div>
              </div>
            </div>

            {/* D3 GEX Chart Preview */}
            <div className="lg:col-span-3 p-5 flex flex-col gap-4 min-h-[450px]">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold font-mono text-white/70">SPX Net GEX By Strike (Real-time CBOE Feed Simulation)</span>
                </div>
                <div className="text-xs text-white/40 font-mono">Spot: $5425</div>
              </div>
              
              <div className="flex-1 w-full bg-black/40 border border-white/5 rounded p-3 flex items-center justify-center overflow-x-auto">
                <GEXByStrikeChart
                  startData={mockOptionChain}
                  endData={mockOptionChain}
                  ticker="SPX"
                  startSpotPrice={spotPrice}
                  endSpotPrice={spotPrice}
                  selectedExpiries={expiries}
                  pricingMethod={pricingMethod}
                  onPricingMethodChange={setPricingMethod}
                />
              </div>
            </div>
          </div>
        </section>

        {/* FEATURES GRID */}
        <section id="features" className="grid grid-cols-1 md:grid-cols-3 gap-6 font-mono text-xs">
          <div className="glass-panel border border-white/5 rounded-lg p-6 bg-black/40 hover:border-emerald-500/20 transition-all flex flex-col gap-3">
            <Layers className="w-6 h-6 text-emerald-400" />
            <h3 className="text-sm font-bold text-white font-display">GEX HEAT BANDS</h3>
            <p className="text-white/50 leading-relaxed">
              Overlay opacity-scaled heat bands directly on a full-screen candlestick chart to view where dealer gravity and pinning flows congregate.
            </p>
          </div>

          <div className="glass-panel border border-white/5 rounded-lg p-6 bg-black/40 hover:border-cyan-500/20 transition-all flex flex-col gap-3">
            <Activity className="w-6 h-6 text-cyan-400" />
            <h3 className="text-sm font-bold text-white font-display">QUANTUM TUNNELING</h3>
            <p className="text-white/50 leading-relaxed">
              Calculate the probability of spot breaching major Call or Put walls based on dynamic option cluster density and market volatility regimes.
            </p>
          </div>

          <div className="glass-panel border border-white/5 rounded-lg p-6 bg-black/40 hover:border-[#ff3366]/20 transition-all flex flex-col gap-3">
            <Globe className="w-6 h-6 text-[#ff3366]" />
            <h3 className="text-sm font-bold text-white font-display">INDIA REGION ISO</h3>
            <p className="text-white/50 leading-relaxed">
              NSE dashboard supports Indian index options with compliance-locked geoblocks to maintain isolated market-specific data feeds.
            </p>
          </div>
        </section>

        {/* PRICING SECTION */}
        <section id="pricing" className="flex flex-col gap-8">
          <div className="text-center">
            <h2 className="text-xs font-bold text-emerald-400 font-mono tracking-widest uppercase">PRICING AND ACCESS</h2>
            <p className="text-2xl font-bold mt-1 text-white">Select Your Terminal Tier</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto w-full">
            {/* Free Tier */}
            <div 
              onClick={() => setSelectedTier("Free")}
              className={`glass-panel border rounded-xl p-6 bg-black/40 flex flex-col justify-between cursor-pointer transition-all ${selectedTier === "Free" ? "border-emerald-500 shadow-emerald-500/5 shadow-2xl" : "border-white/5 hover:border-white/10"}`}
            >
              <div className="flex flex-col gap-4 font-mono">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-white">Free Terminal</span>
                  {selectedTier === "Free" && <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />}
                </div>
                <div className="text-3xl font-bold text-white">$0</div>
                <p className="text-xs text-white/40 leading-relaxed">
                  Basic terminal dashboard with 15-minute delayed data and standard strike charts.
                </p>
                <div className="flex flex-col gap-2 mt-2">
                  <div className="flex items-center gap-2 text-[11px] text-white/60">
                    <Check className="w-3.5 h-3.5 text-emerald-400" /> Delayed CBOE feeds
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-white/60">
                    <Check className="w-3.5 h-3.5 text-emerald-400" /> Standard GEX strike charts
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-white/30 line-through">
                    <Lock className="w-3 h-3" /> Real-time settlebomb ideas
                  </div>
                </div>
              </div>
              <button className="w-full mt-6 py-2 border border-white/10 hover:bg-white/5 transition-all text-xs font-bold rounded">
                JOIN FREE WAITLIST
              </button>
            </div>

            {/* Pro Tier (Recommended) */}
            <div 
              onClick={() => setSelectedTier("Pro")}
              className={`glass-panel border rounded-xl p-6 bg-black/50 flex flex-col justify-between cursor-pointer relative overflow-hidden transition-all ${selectedTier === "Pro" ? "border-emerald-500 shadow-emerald-500/10 shadow-2xl" : "border-white/5 hover:border-white/10"}`}
            >
              <div className="absolute top-0 right-0 bg-emerald-500 text-black text-[9px] font-bold px-3 py-1 rounded-bl uppercase font-mono tracking-wider">
                RECOMMENDED
              </div>
              <div className="flex flex-col gap-4 font-mono">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-white">Pro Access</span>
                  {selectedTier === "Pro" && <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />}
                </div>
                <div className="text-3xl font-bold text-white">
                  $199<span className="text-xs text-white/40">/yr</span>
                </div>
                <p className="text-xs text-white/40 leading-relaxed">
                  Bypass the waitlist queue. Priority developer access and full real-time GEX suite tools.
                </p>
                <div className="flex flex-col gap-2 mt-2">
                  <div className="flex items-center gap-2 text-[11px] text-white/70">
                    <Check className="w-3.5 h-3.5 text-emerald-400" /> Real-time option data feeds
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-white/70">
                    <Check className="w-3.5 h-3.5 text-emerald-400" /> Full Settlebomb pinning engine
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-white/70">
                    <Check className="w-3.5 h-3.5 text-emerald-400" /> Quantum Tunneling & GARCH vol
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-white/70">
                    <Check className="w-3.5 h-3.5 text-emerald-400" /> Unlimited journaling sync
                  </div>
                </div>
              </div>
              <button className="w-full mt-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-black transition-all text-xs rounded shadow-lg shadow-emerald-500/10">
                PRE-ORDER PRO BETA
              </button>
            </div>

            {/* Lifetime Tier */}
            <div 
              onClick={() => setSelectedTier("Lifetime")}
              className={`glass-panel border rounded-xl p-6 bg-black/40 flex flex-col justify-between cursor-pointer transition-all ${selectedTier === "Lifetime" ? "border-emerald-500 shadow-emerald-500/5 shadow-2xl" : "border-white/5 hover:border-white/10"}`}
            >
              <div className="flex flex-col gap-4 font-mono">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-white">Lifetime access</span>
                  {selectedTier === "Lifetime" && <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />}
                </div>
                <div className="text-3xl font-bold text-white">$499</div>
                <p className="text-xs text-white/40 leading-relaxed">
                  One-time purchase. Lifetime terminal updates, priority support, and private discord access.
                </p>
                <div className="flex flex-col gap-2 mt-2">
                  <div className="flex items-center gap-2 text-[11px] text-white/70">
                    <Check className="w-3.5 h-3.5 text-emerald-400" /> All Pro terminal features
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-white/70">
                    <Check className="w-3.5 h-3.5 text-emerald-400" /> One-time fee, no recurring charges
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-white/70">
                    <Check className="w-3.5 h-3.5 text-emerald-400" /> Priority discord chatroom
                  </div>
                </div>
              </div>
              <button className="w-full mt-6 py-2 border border-white/10 hover:bg-white/5 transition-all text-xs font-bold rounded">
                PRE-ORDER LIFETIME
              </button>
            </div>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-12 px-6 bg-black/80 font-mono text-[10px] text-white/30 max-w-7xl mx-auto w-full flex flex-col md:flex-row justify-between items-center gap-6 mt-16">
        <span>© 2026 GammaEx. All rights reserved.</span>
        <div className="flex gap-6">
          <a href="#" className="hover:text-white transition-all">TERMS OF USE</a>
          <a href="#" className="hover:text-white transition-all">PRIVACY STATEMENT</a>
          <a href="#" className="hover:text-white transition-all">CBOE COMPLIANCE</a>
        </div>
      </footer>
    </div>
  )
}
