import { createClient } from "@/lib/supabase/server"

export type CreativeTest = {
  id: string
  client_id: string
  concept_name: string
  adset_id: string
  adset_name: string | null
  campaign_id: string | null
  variant_ad_ids: string[]
  variant_count: number
  first_live_date: string | null
  days_live: number
  total_spend: number
  total_conversions: number
  status: "monitoring" | "ready" | "analysed" | "flagged"
  outcome: "win" | "lose" | "inconclusive" | null
  ready_at: string | null
  analysed_at: string | null
  notion_page_id: string | null
  notion_page_url: string | null
  notion_matched: boolean
  flag_reason: string | null
  created_at: string
  updated_at: string
}

export type CreativeTestResult = {
  id: string
  test_id: string
  ad_id: string
  ad_name: string | null
  hook_label: string | null
  spend: number
  impressions: number
  landing_page_views: number
  adds_to_cart: number
  checkouts_initiated: number
  purchases: number
  purchase_value: number
  cpa: number | null
  roas: number | null
  landing_rate: number | null
  cart_rate: number | null
  purchase_rate: number | null
  spend_share: number | null
  classification: string | null
  fatigue_status: string | null
  is_best_variant: boolean
  recent_spend: number
  recent_conversions: number
  recent_cpa: number | null
}

export type CreativeTestConfig = {
  client_id: string
  enabled: boolean
  min_days_live: number
  min_spend: number
  min_conversions: number
  high_spend_alert: number
  notion_board_id: string | null
  slack_channel_id: string | null
}

export type CreativeTestsData = {
  tests: CreativeTest[]
  results: Record<string, CreativeTestResult[]>
  config: CreativeTestConfig | null
  thumbnails: Record<string, string>
  currency: string
  keyAction: string
}

export async function fetchCreativeTests(
  clientId: string
): Promise<CreativeTestsData | null> {
  const supabase = createClient()

  // Parallel fetches
  const [clientResp, testsResp, configResp, scorecardResp] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, currency_code")
      .eq("id", clientId)
      .single(),
    supabase
      .from("creative_tests")
      .select("*")
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("creative_test_config")
      .select("*")
      .eq("client_id", clientId)
      .maybeSingle(),
    supabase
      .from("client_scorecard_config")
      .select("key_action")
      .eq("client_id", clientId)
      .maybeSingle(),
  ])

  if (!clientResp.data) return null

  const tests: CreativeTest[] = testsResp.data ?? []
  const config: CreativeTestConfig | null = configResp.data ?? null
  const keyAction = scorecardResp.data?.key_action ?? "purchases"

  // Fetch results for all analysed tests
  const analysedIds = tests
    .filter((t) => t.status === "analysed")
    .map((t) => t.id)

  let allResults: CreativeTestResult[] = []
  if (analysedIds.length > 0) {
    const resultsResp = await supabase
      .from("creative_test_results")
      .select("*")
      .in("test_id", analysedIds)
    allResults = resultsResp.data ?? []
  }

  // Group results by test_id
  const results: Record<string, CreativeTestResult[]> = {}
  for (const r of allResults) {
    if (!results[r.test_id]) results[r.test_id] = []
    results[r.test_id].push(r)
  }

  // Fetch thumbnails for all variant ad IDs
  const allAdIds = tests.flatMap((t) => t.variant_ad_ids)
  const thumbnails: Record<string, string> = {}
  if (allAdIds.length > 0) {
    // Batch in chunks of 300 (Supabase .in() limit)
    for (let i = 0; i < allAdIds.length; i += 300) {
      const chunk = allAdIds.slice(i, i + 300)
      const thumbResp = await supabase
        .from("meta_ad_metadata")
        .select("ad_id, creative_thumbnail_url")
        .in("ad_id", chunk)
      for (const row of thumbResp.data ?? []) {
        if (row.creative_thumbnail_url) {
          thumbnails[row.ad_id] = row.creative_thumbnail_url
        }
      }
    }
  }

  return {
    tests,
    results,
    config,
    thumbnails,
    currency: clientResp.data.currency_code ?? "GBP",
    keyAction,
  }
}
