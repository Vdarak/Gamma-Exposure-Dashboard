import { GammaExposureDashboard } from "@/components/gamma-exposure-dashboard"
import { DashboardShell } from "@/components/layout/DashboardShell"

export default function HomePage() {
  return (
    <DashboardShell>
      <GammaExposureDashboard />
    </DashboardShell>
  )
}
