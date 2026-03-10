export const dynamic = "force-dynamic"

import { createServiceClient } from "@/lib/supabase/server"
import type { CustomMetric } from "@/lib/utils/types"
import CustomMetricsManager from "@/components/settings/custom-metrics-manager"

export default async function SettingsPage() {
  const supabase = createServiceClient()

  const { data: metrics } = await supabase
    .from("custom_metrics")
    .select("*")
    .order("is_preset", { ascending: false })
    .order("name")

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Manage custom metrics and dashboard configuration.
        </p>
      </div>

      <CustomMetricsManager initialMetrics={(metrics as CustomMetric[]) || []} />
    </div>
  )
}
