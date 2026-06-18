"use client"

import React, { useState, useEffect, useRef } from "react"
import { Send, RefreshCw, Bot, Terminal, X, BookOpen } from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string
  role: 'user' | 'model'
  text: string
  timestamp: Date
}

// ─── Markdown Renderer ────────────────────────────────────────────────

function MarkdownRenderer({ text }: { text: string }) {
  if (!text) return null

  const lines = text.split("\n")
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Heading: ### or ## or #
    if (line.startsWith("### ")) {
      elements.push(
        <div key={i} className="text-[11px] font-bold text-white mt-2 mb-0.5 font-mono uppercase tracking-wider">
          {parseInline(line.slice(4))}
        </div>
      )
      i++
      continue
    }
    if (line.startsWith("## ")) {
      elements.push(
        <div key={i} className="text-[12px] font-bold text-white mt-2.5 mb-1 font-mono border-b border-[#1A1A1E] pb-0.5">
          {parseInline(line.slice(3))}
        </div>
      )
      i++
      continue
    }
    if (line.startsWith("# ")) {
      elements.push(
        <div key={i} className="text-[13px] font-bold text-[#00E676] mt-3 mb-1 font-mono">
          {parseInline(line.slice(2))}
        </div>
      )
      i++
      continue
    }

    // Horizontal rule: --- or ***
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      elements.push(<hr key={i} className="border-[#1A1A1E] my-2" />)
      i++
      continue
    }

    // Ordered list item: 1. text
    const orderedMatch = line.match(/^(\d+)\.\s+(.*)$/)
    if (orderedMatch) {
      const listItems: React.ReactNode[] = []
      let j = i
      let counter = 0
      while (j < lines.length) {
        const om = lines[j].match(/^(\d+)\.\s+(.*)$/)
        if (!om) break
        counter++
        listItems.push(
          <div key={j} className="flex items-start gap-2 my-0.5">
            <span className="text-[#00E676] shrink-0 font-bold min-w-[14px] text-right">{counter}.</span>
            <span>{parseInline(om[2])}</span>
          </div>
        )
        j++
      }
      elements.push(
        <div key={i} className="space-y-0.5 my-1">
          {listItems}
        </div>
      )
      i = j
      continue
    }

    // Unordered list item: - or * or + text
    const bulletMatch = line.match(/^(\s*)([-*+])\s+(.*)$/)
    if (bulletMatch) {
      const listItems: React.ReactNode[] = []
      let j = i
      while (j < lines.length) {
        const bm = lines[j].match(/^(\s*)([-*+])\s+(.*)$/)
        if (!bm) break
        const indentLevel = Math.floor(bm[1].length / 2)
        listItems.push(
          <div key={j} className={`flex items-start gap-1.5 my-0.5 ${indentLevel > 0 ? `pl-${Math.min(indentLevel * 4, 8)}` : ''}`}>
            <span className="text-[#00E676] mt-0.5 shrink-0 text-[10px]">
              {indentLevel === 0 ? '•' : '◦'}
            </span>
            <span>{parseInline(bm[3])}</span>
          </div>
        )
        j++
      }
      elements.push(
        <div key={i} className="space-y-0.5 my-1">
          {listItems}
        </div>
      )
      i = j
      continue
    }

    // Code block: ```
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      let j = i + 1
      while (j < lines.length && !lines[j].startsWith("```")) {
        codeLines.push(lines[j])
        j++
      }
      elements.push(
        <div key={i} className="my-2 rounded-md overflow-hidden border border-[#1A1A1E]">
          {lang && (
            <div className="bg-[#0A0C10] border-b border-[#1A1A1E] px-3 py-1 text-[9px] font-mono text-[#555] uppercase tracking-wider">
              {lang}
            </div>
          )}
          <pre className="bg-black/60 px-3 py-2.5 text-[10px] font-mono text-[#00E676] overflow-x-auto leading-relaxed whitespace-pre-wrap">
            {codeLines.join("\n")}
          </pre>
        </div>
      )
      i = j + 1
      continue
    }

    // Blockquote: > text
    if (line.startsWith("> ")) {
      elements.push(
        <div key={i} className="border-l-2 border-[#00E676]/40 pl-3 my-1.5 text-gray-400 italic">
          {parseInline(line.slice(2))}
        </div>
      )
      i++
      continue
    }

    // Table: | col | col |
    if (line.startsWith("|") && lines[i + 1]?.match(/^\|[\s\-|]+\|$/)) {
      const tableRows: string[][] = []
      let j = i
      while (j < lines.length && lines[j].startsWith("|")) {
        if (lines[j].match(/^\|[\s\-|]+\|$/)) { j++; continue } // skip separator
        const cells = lines[j].split("|").slice(1, -1).map(c => c.trim())
        tableRows.push(cells)
        j++
      }
      if (tableRows.length > 0) {
        const [header, ...rows] = tableRows
        elements.push(
          <div key={i} className="my-2 overflow-x-auto rounded border border-[#1A1A1E]">
            <table className="w-full text-[10px] font-mono">
              <thead>
                <tr className="bg-[#0A0C10] border-b border-[#1A1A1E]">
                  {header.map((cell, ci) => (
                    <th key={ci} className="px-2.5 py-1.5 text-left text-[#888] font-bold uppercase tracking-wider whitespace-nowrap">
                      {parseInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-[#1A1A1E]/50 hover:bg-white/[0.02]">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-2.5 py-1.5 text-gray-300 whitespace-nowrap">
                        {parseInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
        i = j
        continue
      }
    }

    // Empty line → spacer
    if (line.trim() === "") {
      elements.push(<div key={i} className="h-1.5" />)
      i++
      continue
    }

    // Regular paragraph
    elements.push(
      <div key={i} className="leading-relaxed">
        {parseInline(line)}
      </div>
    )
    i++
  }

  return <div className="space-y-0.5 select-text">{elements}</div>
}

function parseInline(text: string): React.ReactNode {
  if (!text) return null

  const parts: React.ReactNode[] = []
  let current = ""
  let i = 0

  while (i < text.length) {
    // Bold+italic: ***text***
    if (text.slice(i, i + 3) === "***") {
      const end = text.indexOf("***", i + 3)
      if (end !== -1) {
        if (current) { parts.push(current); current = "" }
        parts.push(
          <strong key={i} className="font-bold italic text-white">
            {text.slice(i + 3, end)}
          </strong>
        )
        i = end + 3
        continue
      }
    }
    // Bold: **text**
    if (text.slice(i, i + 2) === "**") {
      const end = text.indexOf("**", i + 2)
      if (end !== -1) {
        if (current) { parts.push(current); current = "" }
        parts.push(
          <strong key={i} className="font-bold text-white">
            {text.slice(i + 2, end)}
          </strong>
        )
        i = end + 2
        continue
      }
    }
    // Italic: *text* or _text_
    if ((text[i] === "*" || text[i] === "_") && text[i + 1] !== text[i]) {
      const marker = text[i]
      const end = text.indexOf(marker, i + 1)
      if (end !== -1 && end > i + 1) {
        if (current) { parts.push(current); current = "" }
        parts.push(
          <em key={i} className="italic text-gray-300">
            {text.slice(i + 1, end)}
          </em>
        )
        i = end + 1
        continue
      }
    }
    // Inline code: `code`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1)
      if (end !== -1) {
        if (current) { parts.push(current); current = "" }
        parts.push(
          <code key={i} className="bg-black/60 border border-[#1A1A1E] px-1 py-0.5 rounded text-[9px] text-[#00E676] font-mono">
            {text.slice(i + 1, end)}
          </code>
        )
        i = end + 1
        continue
      }
    }
    // Strikethrough: ~~text~~
    if (text.slice(i, i + 2) === "~~") {
      const end = text.indexOf("~~", i + 2)
      if (end !== -1) {
        if (current) { parts.push(current); current = "" }
        parts.push(
          <span key={i} className="line-through text-gray-500">
            {text.slice(i + 2, end)}
          </span>
        )
        i = end + 2
        continue
      }
    }
    current += text[i]
    i++
  }

  if (current) parts.push(current)
  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : <>{parts}</>
}

// ─── Chat Messages Area ───────────────────────────────────────────────

interface ChatMessagesProps {
  messages: ChatMessage[]
  isLoading: boolean
  loadingLabel?: string
  chatEndRef: React.RefObject<HTMLDivElement | null>
}

export function ChatMessages({ messages, isLoading, loadingLabel = "Processing...", chatEndRef }: ChatMessagesProps) {
  return (
    <div className="flex-1 overflow-y-auto space-y-4 pr-1 select-text min-h-0">
      {messages.map((msg) => {
        const isModel = msg.role === 'model'
        return (
          <div
            key={msg.id}
            className={`flex items-start gap-2.5 ${isModel ? 'justify-start' : 'justify-end'}`}
          >
            {isModel && (
              <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-[#00E676] via-[#00B0FF] to-[#7C4DFF] flex items-center justify-center shrink-0 shadow-[0_0_8px_rgba(0,230,118,0.25)] mt-0.5">
                <Bot className="w-3.5 h-3.5 text-white" />
              </div>
            )}
            <div
              className={`max-w-[88%] rounded-xl px-3 py-2.5 font-mono text-[11px] leading-relaxed border select-text ${
                isModel
                  ? 'bg-[#0A0C10] border-[#1C202E] text-gray-300'
                  : 'bg-[#0052FF]/10 border-[#0052FF]/25 text-white'
              }`}
            >
              <MarkdownRenderer text={msg.text} />
              <span className="block text-[8px] text-gray-600 text-right mt-1.5">
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        )
      })}
      {isLoading && (
        <div className="flex items-center gap-2 text-[10px] text-[#555] font-mono italic pl-8">
          <RefreshCw className="w-3 h-3 animate-spin text-[#00E676]" />
          <span>{loadingLabel}</span>
        </div>
      )}
      <div ref={chatEndRef} />
    </div>
  )
}

// ─── Chat Input ───────────────────────────────────────────────────────

interface ChatInputProps {
  value: string
  onChange: (val: string) => void
  onSubmit: (e: React.FormEvent) => void
  disabled?: boolean
  placeholder?: string
}

export function ChatInput({ value, onChange, onSubmit, disabled, placeholder = "Ask me anything..." }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`
    }
  }, [value])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() && !disabled) {
        const fakeEvent = { preventDefault: () => {} } as React.FormEvent
        onSubmit(fakeEvent)
      }
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2 pt-2.5 border-t border-[#1C202E]/60">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={3}
        className="flex-1 bg-[#050608] border border-[#1C202E] focus:border-[#2B3045] rounded-lg text-[11px] font-mono px-3 py-2.5 text-white focus:outline-none disabled:opacity-40 resize-none leading-relaxed placeholder-gray-600 transition-colors"
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="px-3 py-2 bg-[#0A0E16] hover:bg-[#141824] text-white border border-[#1C202E] hover:border-[#2B3045] rounded-lg flex items-center justify-center transition-all disabled:opacity-40 self-end mb-0 shrink-0"
        title="Send (Enter)"
      >
        <Send className="w-3.5 h-3.5 text-[#00E676]" />
      </button>
    </form>
  )
}


// ─── Full Panel Container ─────────────────────────────────────────────

export interface AIChatPanelProps {
  title?: string
  isOpen: boolean
  onClose: () => void
  messages: ChatMessage[]
  isLoading: boolean
  loadingLabel?: string
  inputValue: string
  onInputChange: (val: string) => void
  onSend: (e: React.FormEvent) => void
  inputPlaceholder?: string
  /** Extra content to show below the tab bar */
  headerSlot?: React.ReactNode
}

export function AIChatPanelContainer({
  title = "AI ANALYST",
  isOpen,
  onClose,
  messages,
  isLoading,
  loadingLabel,
  inputValue,
  onInputChange,
  onSend,
  inputPlaceholder,
  headerSlot,
}: AIChatPanelProps) {
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (!isOpen) return null

  return (
    <div className="w-[390px] border-l border-[#0E1117] bg-[#07090C] flex flex-col h-full z-30 flex-shrink-0">
      {/* Panel Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#0E1117] bg-[#07090C] flex-shrink-0">
        <div className="flex items-center gap-2 text-white font-mono text-[11px] font-bold tracking-wider">
          <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-[#00E676] via-[#00B0FF] to-[#7C4DFF] flex items-center justify-center shrink-0 shadow-[0_0_6px_rgba(0,230,118,0.3)]">
            <Bot className="w-3 h-3 text-white" />
          </div>
          <span>{title}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-[#1A202C] text-gray-500 hover:text-white rounded transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>



      {/* Optional header slot */}
      {headerSlot && (
        <div className="px-4 py-2 border-b border-[#0E1117] flex-shrink-0">
          {headerSlot}
        </div>
      )}

      {/* Panel Body */}
      <div className="flex-1 flex flex-col min-h-0 p-3.5">
        <div className="flex-1 flex flex-col min-h-0 gap-3">
          <ChatMessages
            messages={messages}
            isLoading={isLoading}
            loadingLabel={loadingLabel}
            chatEndRef={chatEndRef}
          />
          <ChatInput
            value={inputValue}
            onChange={onInputChange}
            onSubmit={onSend}
            disabled={isLoading}
            placeholder={inputPlaceholder}
          />
        </div>
      </div>
    </div>
  )
}
