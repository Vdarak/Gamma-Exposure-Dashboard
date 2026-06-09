"use client"

import type { PricingMethod } from "@/lib/calculations"

interface PricingMethodToggleProps {
  pricingMethod: PricingMethod
  onPricingMethodChange: (method: PricingMethod) => void
}

export function PricingMethodToggle({ pricingMethod, onPricingMethodChange }: PricingMethodToggleProps) {
  return (
    <div className="flex items-center gap-0 border border-[#1A1A1A] rounded bg-[#0A0A0A] p-0.5">
      <button
        onClick={() => onPricingMethodChange('black-scholes')}
        className={`px-2.5 py-1 text-xxs font-mono rounded transition-all ${
          pricingMethod === 'black-scholes'
            ? 'bg-[#1A1A1A] text-terminal-purple'
            : 'text-[#949494] hover:text-[#B5B5B5]'
        }`}
        title="Black-Scholes pricing model (European options)"
      >
        B-S
      </button>
      <button
        onClick={() => onPricingMethodChange('binomial')}
        className={`px-2.5 py-1 text-xxs font-mono rounded transition-all ${
          pricingMethod === 'binomial'
            ? 'bg-[#1A1A1A] text-terminal-green'
            : 'text-[#949494] hover:text-[#B5B5B5]'
        }`}
        title="Binomial Tree pricing model (American options)"
      >
        BIN
      </button>
    </div>
  )
}
