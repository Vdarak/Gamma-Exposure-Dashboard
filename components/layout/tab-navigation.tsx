"use client"

interface TabNavigationProps {
  activeTab: string
  onTabChange: (tab: string) => void
  tabs: { id: string; label: string }[]
}

export function TabNavigation({ activeTab, onTabChange, tabs }: TabNavigationProps) {
  return (
    <div className="border-b border-[#1A1A1A] bg-black">
      <div className="px-4 lg:px-6">
        <nav className="flex items-center gap-0 -mb-px">
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`relative px-4 py-2.5 text-xs font-medium uppercase tracking-wider transition-all ${
                activeTab === tab.id
                  ? 'text-[#E5E5E5] border-b-2 border-terminal-green'
                  : 'text-[#949494] hover:text-[#B5B5B5] border-b-2 border-transparent'
              }`}
            >
              {/* Terminal-style prefix */}
              {activeTab === tab.id && (
                <span className="text-terminal-green mr-1">›</span>
              )}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}
