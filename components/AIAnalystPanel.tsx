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

      const response = await sendAIChatMessage(userMsg.text, apiHistory, ticker, livePrice)

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
    />
  )
}
