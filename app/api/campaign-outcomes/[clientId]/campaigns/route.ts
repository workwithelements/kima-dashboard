import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * GET /api/campaign-outcomes/[clientId]/campaigns
 * Returns distinct campaigns (id + name) for a client from recent performance data.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const db = createServiceClient()

  // Fetch distinct campaigns from meta_daily_performance (last 90 days for relevance)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 90)
  const cutoffStr = cutoff.toISOString().split("T")[0]

  const { data: metaCampaigns, error: metaError } = await db
    .from("meta_daily_performance")
    .select("campaign_id, campaign_name")
    .eq("client_id", params.clientId)
    .gte("date", cutoffStr)
    .gt("spend", 0)

  if (metaError) return safeError(metaError)

  // Deduplicate by campaign_id, keeping the most recent name
  const campaignMap = new Map<string, string>()
  for (const row of metaCampaigns || []) {
    if (row.campaign_id && row.campaign_name) {
      campaignMap.set(row.campaign_id, row.campaign_name)
    }
  }

  // Also fetch Google Ads campaigns
  const { data: gaCampaigns } = await db
    .from("google_ads_daily_performance")
    .select("campaign_id, campaign_name")
    .eq("client_id", params.clientId)
    .gte("date", cutoffStr)
    .gt("spend", 0)

  for (const row of gaCampaigns || []) {
    if (row.campaign_id && row.campaign_name) {
      campaignMap.set(row.campaign_id, row.campaign_name)
    }
  }

  const campaigns = Array.from(campaignMap.entries())
    .map(([campaign_id, campaign_name]) => ({ campaign_id, campaign_name }))
    .sort((a, b) => a.campaign_name.localeCompare(b.campaign_name))

  return NextResponse.json(campaigns)
}
