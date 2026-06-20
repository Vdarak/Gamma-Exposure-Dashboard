"use client"

import React, { useState, useEffect, useRef } from "react"
import { Bot } from "lucide-react"

interface FloatingAskButtonProps {
  onTriggerAI: (context: any) => void
}

export function FloatingAskButton({ onTriggerAI }: FloatingAskButtonProps) {
  const [coords, setCoords] = useState({ x: 0, y: 0 })
  const [activeContext, setActiveContext] = useState<any | null>(null)
  const [showButton, setShowButton] = useState(false)
  
  const currentElementRef = useRef<HTMLElement | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      
      // If hover is over the button itself, do not clear the timer or hide
      if (buttonRef.current && (target === buttonRef.current || buttonRef.current.contains(target))) {
        return
      }

      // Find if cursor is over an element with data-ai-context
      const contextEl = target.closest("[data-ai-context]") as HTMLElement

      if (contextEl) {
        // If we are already hovering over the same element, let the timer continue
        if (currentElementRef.current === contextEl) {
          return
        }

        // We transitioned to a new element - reset timer and state
        if (timerRef.current) {
          clearTimeout(timerRef.current)
        }
        currentElementRef.current = contextEl
        setShowButton(false)

        const rawContext = contextEl.getAttribute("data-ai-context")
        if (rawContext) {
          try {
            const parsed = JSON.parse(rawContext)
            
            // Start a 4.5 second hover timer on the element
            timerRef.current = setTimeout(() => {
              const rect = contextEl.getBoundingClientRect()
              const btnWidth = 86 // Approximate button width
              
              // Position at the top-right corner of the element, inset by 12px
              let targetX = rect.right - btnWidth - 12
              let targetY = rect.top + 12
              
              // Constrain boundaries relative to viewport
              if (targetX < 12) targetX = 12
              if (targetY < 12) targetY = 12
              
              setCoords({ x: targetX, y: targetY })
              setActiveContext(parsed)
              setShowButton(true)
            }, 4500)
          } catch (err) {
            console.error("Error parsing AI context attribute:", err)
          }
        }
      } else {
        // Mouse moved outside any data-ai-context container
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        currentElementRef.current = null
        setShowButton(false)
        setActiveContext(null)
      }
    }

    // Hide the button on scroll or window resize to prevent floating mismatch
    const handleScrollOrResize = () => {
      setShowButton(false)
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      currentElementRef.current = null
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("scroll", handleScrollOrResize, true)
    window.addEventListener("resize", handleScrollOrResize)

    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("scroll", handleScrollOrResize, true)
      window.removeEventListener("resize", handleScrollOrResize)
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  if (!showButton || !activeContext) return null

  return (
    <button
      ref={buttonRef}
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
        setShowButton(false)
      }}
    >
      <Bot className="w-3.5 h-3.5" />
      Ask AI
    </button>
  )
}
