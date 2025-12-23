"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight, BarChart3, TrendingUp, Activity, Layers } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Separator } from "@/components/ui/separator"

interface SidebarProps {
  className?: string
}

export function Sidebar({ className }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)

  const navItems = [
    { icon: BarChart3, label: "Dashboard", href: "/" },
    { icon: TrendingUp, label: "GEX Analysis", href: "#gex" },
    { icon: Activity, label: "Live Data", href: "#live" },
    { icon: Layers, label: "Historical", href: "#historical" },
  ]

  return (
    <aside
      className={cn(
        "fixed left-0 top-14 z-30 hidden h-[calc(100vh-3.5rem)] border-r bg-background transition-all duration-300 md:block",
        collapsed ? "w-16" : "w-64",
        className
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between p-4">
          {!collapsed && <h2 className="text-lg font-semibold">Navigation</h2>}
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-8 w-8 p-0", collapsed && "mx-auto")}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
            <span className="sr-only">Toggle sidebar</span>
          </Button>
        </div>
        <Separator />
        <nav className="flex-1 space-y-1 p-2">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors",
                collapsed && "justify-center"
              )}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="h-5 w-5 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </a>
          ))}
        </nav>
      </div>
    </aside>
  )
}
