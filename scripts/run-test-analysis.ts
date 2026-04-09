/**
 * Worker script: Process pending creative test analysis jobs.
 *
 * Reads from the creative_test_jobs queue and uses the Anthropic API to run
 * the creative-test-performance skill for each pending test.
 *
 * Usage:
 *   npx tsx scripts/run-test-analysis.ts
 *
 * Environment variables required:
 *   ANTHROPIC_API_KEY          — Anthropic API key
 *   NEXT_PUBLIC_SUPABASE_URL   — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — Supabase service role key
 *   SLACK_WEBHOOK_URL          — (optional) Slack webhook for notifications
 */

import Anthropic from "@anthropic-ai/sdk"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE env vars")
  process.exit(1)
}
if (!ANTHROPIC_KEY) {
  console.error("Missing ANTHROPIC_API_KEY")
  process.exit(1)
}

const db = createSupabaseClient(SUPABASE_URL, SUPABASE_KEY)
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY })

async function main() {
  // Fetch pending jobs
  const { data: jobs, error } = await db
    .from("creative_test_jobs")
    .select("id, test_id, client_id")
    .eq("status", "pending")
    .order("created_at")
    .limit(10)

  if (error) {
    console.error("Failed to fetch jobs:", error.message)
    process.exit(1)
  }

  if (!jobs || jobs.length === 0) {
    console.log("No pending jobs.")
    return
  }

  console.log(`Found ${jobs.length} pending job(s)`)

  for (const job of jobs) {
    console.log(`\nProcessing job ${job.id} (test: ${job.test_id})`)

    // Mark as running
    await db
      .from("creative_test_jobs")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", job.id)

    try {
      // Fetch test details
      const { data: test } = await db
        .from("creative_tests")
        .select("concept_name, adset_name, adset_id, variant_ad_ids, notion_page_url")
        .eq("id", job.test_id)
        .single()

      if (!test) throw new Error("Test not found")

      // Fetch client name
      const { data: client } = await db
        .from("clients")
        .select("name")
        .eq("id", job.client_id)
        .single()

      if (!client) throw new Error("Client not found")

      // Fetch a sample ad name to get the concept identifier
      const { data: adRow } = await db
        .from("meta_daily_performance")
        .select("ad_name")
        .in("ad_id", test.variant_ad_ids.slice(0, 1))
        .limit(1)
        .single()

      const sampleAdName = adRow?.ad_name || test.concept_name

      // Build the prompt for Claude
      const prompt = buildAnalysisPrompt({
        clientName: client.name,
        conceptName: test.concept_name,
        adsetName: test.adset_name || test.adset_id,
        sampleAdName,
        notionUrl: test.notion_page_url || undefined,
        variantCount: test.variant_ad_ids.length,
      })

      console.log(`  Client: ${client.name}, Concept: ${test.concept_name}`)
      console.log(`  Sending to Claude API...`)

      // Call Claude API
      // NOTE: This is a basic implementation. In production, you would add
      // tool definitions for Meta Ads API, Notion API, and Slack API
      // so Claude can execute the full creative-test-performance workflow.
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      })

      const responseText = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")

      console.log(`  Analysis complete (${responseText.length} chars)`)

      // Mark as completed
      await db
        .from("creative_test_jobs")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", job.id)

    } catch (err: any) {
      console.error(`  Job ${job.id} failed:`, err.message)
      await db
        .from("creative_test_jobs")
        .update({
          status: "failed",
          error: err.message?.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
    }
  }

  console.log("\nDone.")
}

function buildAnalysisPrompt(opts: {
  clientName: string
  conceptName: string
  adsetName: string
  sampleAdName: string
  notionUrl?: string
  variantCount: number
}): string {
  return [
    `Run the creative-test-performance analysis for the following test:`,
    ``,
    `Client: ${opts.clientName}`,
    `Concept name: ${opts.conceptName}`,
    `Ad set: ${opts.adsetName}`,
    `Sample ad name: ${opts.sampleAdName}`,
    `Number of variants: ${opts.variantCount}`,
    opts.notionUrl ? `Notion page: ${opts.notionUrl}` : `Notion page: not linked yet`,
    ``,
    `Please analyze the performance data, classify variants, identify the winner,`,
    `compare against peer concepts in the ad set, and provide key learnings.`,
  ].join("\n")
}

main().catch((err) => {
  console.error("Unhandled error:", err)
  process.exit(1)
})
