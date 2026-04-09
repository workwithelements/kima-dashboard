import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { sendSlackMessage } from "@/lib/utils/slack"
import { isConformingAdName, type NamingConfig } from "@/lib/utils/ad-name-parser"

/**
 * POST /api/cron/check-ready-tests — daily check for ready creative tests.
 *
 * Called by the kima-sync GitHub Action after the daily data pull.
 * Secured with CRON_SECRET bearer token.
 *
 * 1. Finds all tests with status "ready" that have no pending/running job
 * 2. Filters to only conforming tests (valid naming conventions)
 * 3. Creates a job for each
 * 4. Sends a Slack notification listing the ready tests
 */
export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({
      error: "Unauthorized",
      debug: {
        hasCronSecret: !!cronSecret,
        cronSecretLength: cronSecret?.length ?? 0,
        hasAuthHeader: !!authHeader,
        authHeaderLength: authHeader?.length ?? 0,
      },
    }, { status: 401 })
  }

  const db = createServiceClient()

  // Find all ready tests
  const { data: readyTests, error: testsErr } = await db
    .from("creative_tests")
    .select("id, client_id, concept_name, adset_name, variant_ad_ids, notion_page_url")
    .eq("status", "ready")

  if (testsErr || !readyTests || readyTests.length === 0) {
    return NextResponse.json({ message: "No ready tests found", queued: 0 })
  }

  // Find tests that already have pending/running jobs
  const testIds = readyTests.map((t) => t.id)
  const { data: existingJobs } = await db
    .from("creative_test_jobs")
    .select("test_id")
    .in("test_id", testIds)
    .in("status", ["pending", "running"])

  const jobbedIds = (existingJobs ?? []).map((j: any) => j.test_id)
  const jobbed = new Set(jobbedIds)
  const unqueuedTests = readyTests.filter((t: any) => !jobbed.has(t.id))

  if (unqueuedTests.length === 0) {
    return NextResponse.json({ message: "All ready tests already queued", queued: 0 })
  }

  // Fetch naming configs per client for validation
  const clientIds = Array.from(new Set(unqueuedTests.map((t: any) => t.client_id as string)))
  const namingConfigs = new Map<string, NamingConfig>()

  for (const cid of clientIds) {
    const { data } = await db
      .from("client_naming_config")
      .select("positions, value_maps")
      .eq("client_id", cid)
      .maybeSingle()

    if (data?.positions) {
      namingConfigs.set(cid, {
        positions: data.positions as NamingConfig["positions"],
        valueMaps: (data.value_maps || {}) as NamingConfig["valueMaps"],
      })
    }
  }

  // Fetch ad names for variant ads to validate naming conventions
  const allAdIds = unqueuedTests.flatMap((t) => t.variant_ad_ids)
  const adNameMap: Record<string, string> = {}

  for (let i = 0; i < allAdIds.length; i += 300) {
    const chunk = allAdIds.slice(i, i + 300)
    const { data } = await db
      .from("meta_daily_performance")
      .select("ad_id, ad_name")
      .in("ad_id", chunk)
      .limit(chunk.length)

    for (const row of data ?? []) {
      if (row.ad_name && !adNameMap[row.ad_id]) {
        adNameMap[row.ad_id] = row.ad_name
      }
    }
  }

  // Filter to conforming tests only
  const conforming = unqueuedTests.filter((test: any) => {
    const cfg = namingConfigs.get(test.client_id)
    return test.variant_ad_ids.length > 0 &&
      test.variant_ad_ids.every((adId: string) => {
        const name = adNameMap[adId]
        return name && isConformingAdName(name, cfg)
      })
  })

  if (conforming.length === 0) {
    return NextResponse.json({ message: "No conforming ready tests to queue", queued: 0 })
  }

  // Fetch client names for Slack message
  const { data: clients } = await db
    .from("clients")
    .select("id, name")
    .in("id", clientIds)

  const clientNameMap = new Map<string, string>()
  for (const c of clients ?? []) clientNameMap.set(c.id, c.name)

  // Create jobs for each conforming test
  const jobs = conforming.map((t) => ({
    test_id: t.id,
    client_id: t.client_id,
    status: "pending" as const,
  }))

  const { error: insertErr } = await db.from("creative_test_jobs").insert(jobs)

  if (insertErr) {
    console.error("[check-ready-tests] failed to insert jobs:", insertErr.message)
    return NextResponse.json({ error: "Failed to create jobs" }, { status: 500 })
  }

  // Build and send Slack notification
  const byClient = new Map<string, any[]>()
  for (const t of conforming) {
    const group = byClient.get((t as any).client_id) || []
    group.push(t)
    byClient.set((t as any).client_id, group)
  }

  const lines: string[] = []
  byClient.forEach((tests, clientId) => {
    const name = clientNameMap.get(clientId) || "Unknown Client"
    lines.push(`*${name}*`)
    for (const t of tests) {
      const link = t.notion_page_url
        ? ` - <${t.notion_page_url}|View>`
        : ""
      lines.push(`  \u2022 ${t.concept_name} (${t.adset_name || "—"}) - Ready for analysis${link}`)
    }
  })

  await sendSlackMessage(lines.join("\n"))

  return NextResponse.json({
    message: `Queued ${conforming.length} test(s) for analysis`,
    queued: conforming.length,
  })
}
