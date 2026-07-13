export const dynamic = "force-dynamic"

import { createClient, createServiceClient } from "@/lib/supabase/server"
import type { CustomMetric } from "@/lib/utils/types"
import CustomMetricsManager from "@/components/settings/custom-metrics-manager"
import TeamManager from "@/components/settings/team-manager"
import { ADMIN_EMAIL } from "@/lib/auth/admin"

export default async function SettingsPage() {
  const supabase = createServiceClient()
  const userClient = createClient()

  const [{ data: metrics }, { data: { user } }] = await Promise.all([
    supabase
      .from("custom_metrics")
      .select("*")
      .order("is_preset", { ascending: false })
      .order("name"),
    userClient.auth.getUser(),
  ])

  const currentEmail = user?.email || ""
  const isAdmin = currentEmail === ADMIN_EMAIL

  // Fetch team members server-side for admin only
  let teamMembers: { id: string; email: string; created_at: string; last_sign_in_at: string | null }[] = []
  if (isAdmin) {
    const { data } = await supabase.auth.admin.listUsers()
    teamMembers = (data?.users || []).map((u) => ({
      id: u.id,
      email: u.email || "",
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at || null,
    }))
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Manage custom metrics and dashboard configuration.
        </p>
      </div>

      {isAdmin && (
        <TeamManager initialMembers={teamMembers} currentUserEmail={currentEmail} />
      )}

      <CustomMetricsManager initialMetrics={(metrics as CustomMetric[]) || []} />
    </div>
  )
}
