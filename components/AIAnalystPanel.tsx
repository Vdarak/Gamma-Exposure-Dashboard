"use client"

import React, { useState, useEffect } from "react"
import { sendAIChatMessage, JournalTrade } from "@/lib/backend-api"
import { AIChatPanelContainer, ChatMessage } from "./AIChatPanel"

interface AIAnalystPanelProps {
  ticker?: string
  timeframe?: 'Intraday' | 'Daily' | '5-Day'
  livePrice?: number
  isOpen: boolean
  onClose: () => void
  onTradeLogged?: (trade: JournalTrade) => void
  showBriefingTab?: boolean

  /** Optional panel title override */
  title?: string
  /** Optional welcome message override */
  welcomeMessage?: string
  /** Optional placeholder override */
  inputPlaceholder?: string

  // Context & 0DTE mode sync
  is0DteMode?: boolean
  on0DteModeChange?: (val: boolean) => void
  uiContext?: any
  onClearUiContext?: () => void
  optionData?: any[]
}

const DEFAULT_WELCOME = `Hello! I'm your **GEX Terminal AI Analyst**.

I can help you understand **gamma exposure** dynamics, analyze **option positioning**, and log trades on your behalf.

**Try asking:**
- *"What is the current market regime based on GEX?"*
- *"Log a buy: 10 contracts SPY 750C, expiry 2026-06-20, entry $6.50, exit $8.20"*
- *"Explain gamma flip and its implications"*`

const JOURNAL_WELCOME = `Hello! I'm your **Journal AI Agent**.

I can help you log trades by voice-to-text style commands and answer questions about your portfolio performance.

**Try telling me:**
- *"Log a buy: 10 SPY 750C contracts, expiry 2026-06-20, entry $6.50, exit $8.20"*
- *"What was my best trade this week?"*
- *"Show me my win rate breakdown"*`

export function AIAnalystPanel({
  ticker = "SPX",
  timeframe = "Intraday",
  livePrice,
  isOpen,
  onClose,
  onTradeLogged,
  title = "AI ANALYST",
  welcomeMessage,
  inputPlaceholder,
  is0DteMode = false,
  on0DteModeChange,
  uiContext,
  onClearUiContext,
  optionData,
}: AIAnalystPanelProps) {
  const welcome = welcomeMessage ?? DEFAULT_WELCOME

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'model',
      text: welcome,
      timestamp: new Date()
    }
  ])
  const [inputText, setInputText] = useState("")
  const [isChatLoading, setIsChatLoading] = useState(false)

  // Auto-fill query if context is received
  useEffect(() => {
    if (uiContext && uiContext.promptTemplate) {
      setInputText(uiContext.promptTemplate)
    }
  }, [uiContext])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputText.trim()) return

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      text: inputText,
      timestamp: new Date()
    }

    setChatMessages(prev => [...prev, userMsg])
    setInputText("")
    setIsChatLoading(true)

    try {
      const apiHistory = chatMessages
        .filter(m => m.id !== 'welcome')
        .map(m => ({ role: m.role, text: m.text }))

      const response = await sendAIChatMessage(
        userMsg.text,
        apiHistory,
        ticker,
        livePrice,
        uiContext,
        is0DteMode,
        optionData
      )

      const modelMsg: ChatMessage = {
        id: `model_${Date.now()}`,
        role: 'model',
        text: response.text,
        timestamp: new Date()
      }

      setChatMessages(prev => [...prev, modelMsg])

      if (response.tradeLogged && onTradeLogged) {
        onTradeLogged(response.tradeLogged)
      }
    } catch (err: any) {
      setChatMessages(prev => [
        ...prev,
        {
          id: `error_${Date.now()}`,
          role: 'model',
          text: `⚠️ **Communication error:** ${err.message}`,
          timestamp: new Date()
        }
      ])
    } finally {
      setIsChatLoading(false)
    }
  }

  const headerSlot = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${is0DteMode ? 'bg-[#00E676] animate-pulse' : 'bg-gray-600'}`} />
          <span className="text-[10px] font-mono font-bold text-[#E5E5E5] uppercase tracking-wider">0DTE Trade Suggester</span>
        </div>
        <button
          onClick={() => on0DteModeChange?.(!is0DteMode)}
          className={`px-2 py-0.5 rounded text-[9px] font-mono font-semibold transition-all border ${
            is0DteMode
              ? 'bg-[#00E676]/10 text-[#00E676] border-[#00E676]/30 shadow-[0_0_8px_rgba(0,230,118,0.15)]'
              : 'bg-black text-[#666] border-[#1C202E] hover:text-[#949494] hover:border-[#2B3045]'
          }`}
        >
          {is0DteMode ? 'ACTIVE' : 'INACTIVE'}
        </button>
      </div>
      {uiContext && (
        <div className="flex items-center justify-between bg-white/[0.02] border border-[#1C202E] rounded px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 overflow-hidden">
            <div className="w-1 h-2 bg-[#00B0FF] rounded-sm shrink-0" />
            <span className="text-[9px] font-mono text-gray-400 truncate">Focusing: {uiContext.component}</span>
          </div>
          <button 
            type="button" 
            onClick={onClearUiContext} 
            className="text-[9px] text-[#FF5252] hover:text-[#FF1744] font-bold font-mono transition-colors pl-2"
          >
            CLEAR
          </button>
        </div>
      )}
    </div>
  )

  return (
    <AIChatPanelContainer
      title={title}
      isOpen={isOpen}
      onClose={onClose}
      messages={chatMessages}
      isLoading={isChatLoading}
      loadingLabel="AI is thinking..."
      inputValue={inputText}
      onInputChange={setInputText}
      onSend={handleSendMessage}
      inputPlaceholder={inputPlaceholder ?? "Ask about GEX, market regimes, or log a trade..."}
      headerSlot={headerSlot}
    />
  )
}
