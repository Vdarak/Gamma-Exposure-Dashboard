"use client"

import { useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { 
  CreditCard, 
  Lock, 
  ShieldCheck, 
  ArrowLeft,
  Loader2,
  Terminal,
  CheckCircle2
} from "lucide-react"

function CheckoutSessionContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const sessionId = searchParams.get("session_id") || "sim_default_session"
  const email = searchParams.get("email") || "dev@gammaex.io"
  const tier = searchParams.get("tier") || "Pro"

  const [cardName, setCardName] = useState("")
  const [cardNumber, setCardNumber] = useState("")
  const [cardExpiry, setCardExpiry] = useState("")
  const [cardCvc, setCardCvc] = useState("")
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle")
  const [statusMessage, setStatusMessage] = useState("")
  const [errorMessage, setErrorMessage] = useState("")

  const amount = tier === "Lifetime" ? "$499" : "$199"
  const priceName = tier === "Lifetime" ? "Lifetime Access" : "Pro Annual Access"

  const handleSimulatePayment = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus("submitting")
    setErrorMessage("")
    
    const steps = [
      "Contacting secure sandbox gateway...",
      "Authorizing simulated credit card...",
      "Generating cryptographic payment proof...",
      "Executing backend webhook callback..."
    ]

    for (let i = 0; i < steps.length; i++) {
      setStatusMessage(steps[i])
      await new Promise(resolve => setTimeout(resolve, 800))
    }

    try {
      const res = await fetch("/api/billing/sim-payment-success", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, email }),
      })

      const data = await res.json()
      if (res.ok && data.success) {
        setStatus("success")
        setStatusMessage("Simulated payment accepted!")
        await new Promise(resolve => setTimeout(resolve, 1000))
        router.push(`/dashboard?session_id=${sessionId}&checkout=success`)
      } else {
        setStatus("error")
        setErrorMessage(data.error || "Simulated payment processing rejected by backend.")
      }
    } catch (err) {
      console.error(err)
      setStatus("error")
      setErrorMessage("Network error connecting to payment gateway backend.")
    }
  }

  return (
    <div className="min-h-screen bg-[#020203] text-white flex flex-col items-center justify-center p-6 relative font-sans overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-900/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-[#ff3366]/5 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff02_1px,transparent_1px),linear-gradient(to_bottom,#ffffff02_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />

      {/* Main card */}
      <div className="glass-panel border border-white/10 rounded-xl bg-black/60 backdrop-blur-md max-w-md w-full p-6 shadow-2xl relative z-10 font-mono text-xs">
        
        {/* Top Logo */}
        <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-6">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-xs tracking-wider text-white">STRIPE SANDBOX</span>
          </div>
          <span className="text-[10px] text-white/40 uppercase">TEST MODE</span>
        </div>

        {status === "success" ? (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 animate-bounce" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Payment Complete</h2>
            <p className="text-white/50 leading-relaxed text-[11px]">
              Your simulated payment succeeded. Redirecting you to the premium terminal...
            </p>
          </div>
        ) : status === "submitting" ? (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
            <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Processing...</h2>
            <p className="text-white/60 font-mono text-[11px] animate-pulse">
              {statusMessage}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSimulatePayment} className="flex flex-col gap-4">
            {/* Purchase description */}
            <div className="bg-white/5 border border-white/5 rounded p-4 flex flex-col gap-1.5">
              <span className="text-[10px] text-white/40 uppercase">Order Summary</span>
              <div className="flex justify-between items-center text-xs">
                <span className="text-white font-bold">{priceName} pre-order</span>
                <span className="text-emerald-400 font-bold">{amount}</span>
              </div>
              <span className="text-[10px] text-white/30 truncate">User: {email}</span>
            </div>

            {errorMessage && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 font-mono leading-relaxed">
                ⚠️ ERROR: {errorMessage}
              </div>
            )}

            {/* Simulated Card Fields */}
            <div className="flex flex-col gap-3 mt-2">
              <span className="text-[10px] text-white/40 uppercase">Payment details</span>
              
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-white/50">Cardholder Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Satoshi Nakamoto"
                  value={cardName}
                  onChange={e => setCardName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500/50 transition-all font-mono"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-white/50">Card Number</label>
                <div className="relative">
                  <CreditCard className="absolute left-3 top-2.5 w-3.5 h-3.5 text-white/30" />
                  <input
                    type="text"
                    required
                    placeholder="4242 4242 4242 4242"
                    value={cardNumber}
                    onChange={e => setCardNumber(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded pl-9 pr-3 py-2 text-white focus:outline-none focus:border-emerald-500/50 transition-all font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-white/50">Expiration (MM/YY)</label>
                  <input
                    type="text"
                    required
                    placeholder="12/28"
                    value={cardExpiry}
                    onChange={e => setCardExpiry(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500/50 transition-all font-mono text-center"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-white/50">CVC</label>
                  <input
                    type="text"
                    required
                    placeholder="123"
                    value={cardCvc}
                    onChange={e => setCardCvc(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500/50 transition-all font-mono text-center"
                  />
                </div>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex flex-col gap-2 mt-4">
              <button
                type="submit"
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-black rounded text-xs transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/10"
              >
                <Lock className="w-3.5 h-3.5" />
                SIMULATE AUTHORIZATION ({amount})
              </button>

              <button
                type="button"
                onClick={() => router.push("/")}
                className="w-full py-2 bg-transparent hover:bg-white/5 border border-white/10 rounded text-xs text-white/50 transition-all flex items-center justify-center gap-1"
              >
                <ArrowLeft className="w-3 h-3" /> CANCEL PAYMENT
              </button>
            </div>
          </form>
        )}

        {/* Footer info */}
        <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-center gap-1.5 text-[10px] text-white/30">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Simulated 256-bit SSL encrypted connection</span>
        </div>
      </div>
    </div>
  )
}

export default function CheckoutSessionPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#020203] text-white flex flex-col items-center justify-center p-6">
        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
      </div>
    }>
      <CheckoutSessionContent />
    </Suspense>
  )
}
