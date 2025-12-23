"use client"

import type React from "react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { Header } from "./Header"
import { Sidebar } from "./Sidebar"

interface DashboardShellProps {
  children: React.ReactNode
  className?: string
  showSidebar?: boolean
}

export function DashboardShell({
  children,
  className,
  showSidebar = false,
}: DashboardShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <div className="relative min-h-screen">
      <Header onMobileMenuToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className="flex">
        {showSidebar && <Sidebar />}
        <main
          className={cn(
            "flex-1 transition-all duration-300",
            showSidebar && "md:ml-64",
            className
          )}
        >
          <div className="container py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
