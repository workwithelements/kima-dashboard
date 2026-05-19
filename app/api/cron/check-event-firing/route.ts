import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { sendSlackMessage } from "@/lib/utils/slack"
import {
  fetchAmplitudeSegmentation,
  collapseSegmentation,
  type AmplitudeCredentials,
} from "@/lib/data/fetch-amplitude-data"
import { daysAgo } from "@/lib/utils/dates"

/**
 * POST /api/cron/check-event-firing — daily check for tracked Amplitude
 * events that have stopped firing.
 *
 * Triggered by the kima-sync GitHub Action after the daily data pull.
 * Secured with CRON_SECRET bearer token.
 *
 * For every (client, event) in `amplitude_events`:
 *   1. Pull the last 8 days of counts from Amplitude.
 *   2. If yesterday = 0 AND prior 7d sum > 0, mark as silent.
 *   3. Only alert on the transition healthy → silent (state stored in
 *      `event_firing_silence`) so we don't spam Slack daily.
 *   4. If a previously-silent event has recovered, mark it recovered.
 *
 * Emits a single grouped Slack message per run when there are new silences.
 */

export const maxDuration = 300

type AmplitudeEventRow = {
  client_id: string
  event_name: string
}

type ClientCreds = {
  id: string
  name: string
  amplitude_api_key: string | null
  amplitude_secret_key: string | null
}

type Silence = {
  client_id: string
  event_name: string
  baseline_7d: number
  silent_since: string
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const db = createServiceClient()

  const { data: events, error: eventsErr } = await db
    .from("amplitude_events")
    .select("client_id, event_name")

  if (eventsErr) {
    console.error("[check-event-firing] failed to load events:", eventsErr.message)
    return NextResponse.json({ error: "Failed to load events" }, { status: 500 })
  }

  const eventRows = (events ?? []) as AmplitudeEventRow[]
  if (eventRows.length === 0) {
    return NextResponse.json({ message: "No tracked events", checked: 0 })
  }

  const clientIds = Array.from(new Set(eventRows.map((e) => e.client_id)))
  const { data: clients } = await db
    .from("clients")
    .select("id, name, amplitude_api_key, amplitude_secret_key")
    .in("id", clientIds)

  const clientById = new Map<string, ClientCreds>()
  for (const c of (clients ?? []) as ClientCreds[]) clientById.set(c.id, c)

  // Date window: yesterday + the 7 days before it.
  const to = daysAgo(1)
  const from = daysAgo(8)

  const { data: activeSilences } = await db
    .from("event_firing_silence")
    .select("client_id, event_name")
    .is("recovered_at", null)

  const activeKey = (cid: string, ev: string) => `${cid}::${ev}`
  const currentlySilent = new Set<string>(
    (activeSilences ?? []).map((s: any) => activeKey(s.client_id, s.event_name))
  )

  const newSilences: Silence[] = []
  const recovered: Array<{ client_id: string; event_name: string }> = []
  const skipped: Array<{ client_id: string; event_name: string; reason: string }> = []
  let checked = 0

  for (const row of eventRows) {
    const client = clientById.get(row.client_id)
    if (!client) continue

    const creds: AmplitudeCredentials | null =
      client.amplitude_api_key && client.amplitude_secret_key
        ? { apiKey: client.amplitude_api_key, secretKey: client.amplitude_secret_key }
        : null

    if (!creds) {
      skipped.push({
        client_id: row.client_id,
        event_name: row.event_name,
        reason: "no_credentials",
      })
      continue
    }

    const res = await fetchAmplitudeSegmentation(
      row.client_id,
      row.event_name,
      from,
      to,
      creds
    )

    if (!res.ok) {
      skipped.push({
        client_id: row.client_id,
        event_name: row.event_name,
        reason: `amplitude_error:${res.error.code}`,
      })
      continue
    }

    checked++

    const series = collapseSegmentation(row.event_name, res.data)
    const yesterdayCount = series.byDate[to] ?? 0
    const baselineSum = Object.entries(series.byDate)
      .filter(([d]) => d !== to)
      .reduce((sum, [, v]) => sum + v, 0)

    const key = activeKey(row.client_id, row.event_name)
    const wasSilent = currentlySilent.has(key)
    const isSilent = yesterdayCount === 0 && baselineSum > 0

    if (isSilent && !wasSilent) {
      newSilences.push({
        client_id: row.client_id,
        event_name: row.event_name,
        baseline_7d: baselineSum,
        silent_since: to,
      })
    } else if (!isSilent && wasSilent && yesterdayCount > 0) {
      recovered.push({ client_id: row.client_id, event_name: row.event_name })
    }
  }

  if (newSilences.length > 0) {
    const { error: insertErr } = await db.from("event_firing_silence").insert(
      newSilences.map((s) => ({
        client_id: s.client_id,
        event_name: s.event_name,
        baseline_7d: s.baseline_7d,
        silent_since: s.silent_since,
      }))
    )
    if (insertErr) {
      console.error("[check-event-firing] failed to log silences:", insertErr.message)
    }

    const byClient = new Map<string, Silence[]>()
    for (const s of newSilences) {
      const group = byClient.get(s.client_id) ?? []
      group.push(s)
      byClient.set(s.client_id, group)
    }

    const lines: string[] = [
      `:rotating_light: *Tracked events stopped firing yesterday (${to})*`,
    ]
    byClient.forEach((items, clientId) => {
      const name = clientById.get(clientId)?.name ?? "Unknown Client"
      lines.push(`*${name}*`)
      for (const s of items) {
        const baseline = Math.round(s.baseline_7d)
        lines.push(`  • \`${s.event_name}\` — 0 yesterday (avg ${baseline} over prior 7d)`)
      }
    })

    await sendSlackMessage(lines.join("\n"))
  }

  if (recovered.length > 0) {
    for (const r of recovered) {
      await db
        .from("event_firing_silence")
        .update({ recovered_at: new Date().toISOString() })
        .eq("client_id", r.client_id)
        .eq("event_name", r.event_name)
        .is("recovered_at", null)
    }
  }

  return NextResponse.json({
    checked,
    new_silences: newSilences.length,
    recovered: recovered.length,
    skipped: skipped.length,
  })
}
