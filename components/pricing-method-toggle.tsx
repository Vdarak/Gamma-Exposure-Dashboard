"use client"

import { Button } from "@/components/ui/button"
import { Calculator, TrendingUp } from "lucide-react"
import type { PricingMethod } from "@/lib/calculations"

interface PricingMethodToggleProps {
  pricingMethod: PricingMethod
  onPricingMethodChange: (method: PricingMethod) => void
}

export function PricingMethodToggle({ pricingMethod, onPricingMethodChange }: PricingMethodToggleProps) {
  return (
    <div className="flex items-center gap-1 bg-[#1A1D36] border border-[#2A3459] rounded-lg p-1">
      <Button
        variant={pricingMethod === 'black-scholes' ? 'default' : 'ghost'}
        size="sm"
        onClick={() => onPricingMethodChange('black-scholes')}
        className={`h-8 px-3 text-xs font-medium transition-all duration-200 ${
          pricingMethod === 'black-scholes'
            ? 'bg-[#7C3AED] text-white border-[#8B5CF6] shadow-sm'
            : 'text-gray-400 hover:text-white hover:bg-[#2A3459]'
        }`}
        title="Black-Scholes pricing model (European options)"
      >
        <Calculator className="w-3 h-3 mr-1" />
        Black-Scholes
      </Button>
      <Button
        variant={pricingMethod === 'binomial' ? 'default' : 'ghost'}
        size="sm"
        onClick={() => onPricingMethodChange('binomial')}
        className={`h-8 px-3 text-xs font-medium transition-all duration-200 ${
          pricingMethod === 'binomial'
            ? 'bg-[#059669] text-white border-[#10B981] shadow-sm'
            : 'text-gray-400 hover:text-white hover:bg-[#2A3459]'
        }`}
        title="Binomial Tree pricing model (American options with early exercise)"
      >
        <TrendingUp className="w-3 h-3 mr-1" />
        Binomial Tree
      </Button>
    </div>
  )
}
