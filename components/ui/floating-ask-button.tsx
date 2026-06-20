"use client"

import React, { useState, useEffect } from "react"
import { Bot } from "lucide-react"

interface FloatingAskButtonProps {
  onTriggerAI: (context: any) => void
}

export function FloatingAskButton({ onTriggerAI }: FloatingAskButtonProps) {
  const [coords, setCoords] = useState({ x: 0, y: 0 })
  const [activeContext, setActiveContext] = useState<any | null>(null)
  const [showButton, setShowButton] = useState(false)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Find if cursor is over an element with data-ai-context
      const target = e.target as HTMLElement
      const contextEl = target.closest("[data-ai-context]") as HTMLElement

      if (contextEl) {
        const rawContext = contextEl.getAttribute("data-ai-context")
        if (rawContext) {
          try {
            const parsed = JSON.parse(rawContext)
            setActiveContext(parsed)
            
            // Constrain coords to keep the button inside the viewport
            const btnWidth = 140
            const btnHeight = 30
            let targetX = e.clientX + 15
            let targetY = e.clientY + 15
            
            if (targetX + btnWidth > window.innerWidth) {
              targetX = e.clientX - btnWidth - 10
            }
            if (targetY + btnHeight > window.innerHeight) {
              targetY = e.clientY - btnHeight - 10
            }
            
            setCoords({ x: targetX, y: targetY })
            setShowButton(true)
            return
          } catch (err) {
            console.error("Error parsing AI context attribute:", err)
          }
        }
      }
      setShowButton(false)
    }

    window.addEventListener("mousemove", handleMouseMove)
    return () => window.removeEventListener("mousemove", handleMouseMove)
  }, [])

  if (!showButton || !activeContext) return null

  return (
    <button
      style={{
        position: "fixed",
        left: coords.x,
        top: coords.y,
        zIndex: 9999,
      }}
      className="px-2.5 py-1.5 bg-[#00E676] hover:bg-[#00c862] text-black border border-[#00e676]/50 text-[10px] font-mono font-black rounded shadow-[0_4px_12px_rgba(0,0,0,0.5)] animate-fade-in flex items-center gap-1.5 cursor-pointer transition-all duration-75 select-none hover:scale-105 active:scale-95"
      onClick={(e) => {
        e.stopPropagation()
        onTriggerAI(activeContext)
      }}
    >
      <Bot className="w-3.5 h-3.5" />
      ASK AI ABOUT THIS
    </button>
  )
}
