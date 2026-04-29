/**
 * Server-side fetcher for Amplitude's Dashboard REST API event segmentation
 * endpoint. Pulls daily counts for a named event so we can render them as a
 * funnel-step bar/card.
 *
 * Docs: https://amplitude.com/docs/apis/analytics/dashboard-rest#segmentation
 *
 * Each Amplitude project has its own API key + secret key (Basic auth), stored
 * per-client on the `clients` row. Tracked event names live in
 * `amplitude_events`.
 */

import { createServiceClient } from "@/lib/supabase/server"

const AMPLITUDE_BASE = "https://amplitude.com/api/2"
/** EU residency endpoint — flip per-client if you ever onboard EU projects. */
// const AMPLITUDE_BASE_EU = "https://analytics.eu.amplitude.com/api/2"

export type AmplitudeSegmentationResponse = {
  data: {
    series?: number[][]
    seriesLabels?: Array<string | number>
    seriesMeta?: unknown[]
    xValues?: string[]
    [key: string]: unknown
  }
}

export type AmplitudeFetchError = {
  /** HTTP status from Amplitude (0 when the call never reached the server) */
  status: number
  /** Short human-readable label, e.g. "Unauthorized", "No credentials" */
  code: string
  /** Optional verbose message from the upstream response or thrown error */
  message?: string
}

/** Daily counts keyed by ISO date (YYYY-MM-DD). */
export type AmplitudeDailySeries = {
  eventName: string
  byDate: Record<string, number>
  /** Total over the queried window. */
  total: number
  /** Present when the upstream call failed or returned no usable data. */
  error?: AmplitudeFetchError
}

export type AmplitudeCredentials = {
  apiKey: string
  secretKey: string
}

async function getCredentials(clientId: string): Promise<AmplitudeCredentials | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from("clients")
    .select("amplitude_api_key, amplitude_secret_key")
    .eq("id", clientId)
    .single()

  if (error || !data?.amplitude_api_key || !data?.amplitude_secret_key) {
    return null
  }
  return {
    apiKey: data.amplitude_api_key,
    secretKey: data.amplitude_secret_key,
  }
}

function statusCode(status: number): string {
  if (status === 401) return "Unauthorized"
  if (status === 403) return "Forbidden"
  if (status === 404) return "Not found"
  if (status === 429) return "Rate limited"
  if (status >= 500) return "Amplitude server error"
  if (status === 0) return "Network error"
  return `HTTP ${status}`
}

/** Amplitude expects YYYYMMDD with no separators. */
function toAmplitudeDate(iso: string): string {
  return iso.replace(/-/g, "").slice(0, 8)
}

export type AmplitudeSegmentationOptions = {
  /** "totals" = total event count (default), "uniques" = unique users */
  metric?: "totals" | "uniques"
}

/**
 * Low-level call to /events/segmentation. Returns either the raw payload or
 * a structured error so callers can surface a useful message.
 */
export async function fetchAmplitudeSegmentation(
  clientId: string,
  eventName: string,
  from: string,
  to: string,
  credsOverride?: AmplitudeCredentials,
  options: AmplitudeSegmentationOptions = {}
): Promise<
  | { ok: true; data: AmplitudeSegmentationResponse }
  | { ok: false; error: AmplitudeFetchError }
> {
  const creds = credsOverride ?? (await getCredentials(clientId))
  if (!creds) {
    return {
      ok: false,
      error: {
        status: 0,
        code: "No credentials",
        message: "Amplitude API key + secret aren't configured for this client.",
      },
    }
  }

  const auth = Buffer.from(`${creds.apiKey}:${creds.secretKey}`).toString("base64")

  const url = new URL(`${AMPLITUDE_BASE}/events/segmentation`)
  url.searchParams.set("e", JSON.stringify({ event_type: eventName }))
  url.searchParams.set("start", toAmplitudeDate(from))
  url.searchParams.set("end", toAmplitudeDate(to))
  url.searchParams.set("m", options.metric ?? "totals")
  url.searchParams.set("i", "1") // 1 = daily bucket

  let res: Response
  try {
    res = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      // Amplitude rate-limits to 360 queries/hour per project; cache briefly
      // when the same series is requested by multiple components.
      next: { revalidate: 60 },
    })
  } catch (err) {
    return {
      ok: false,
      error: {
        status: 0,
        code: "Network error",
        message: err instanceof Error ? err.message : String(err),
      },
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    console.error(
      "[Amplitude] Segmentation query failed",
      eventName,
      res.status,
      body
    )
    return {
      ok: false,
      error: {
        status: res.status,
        code: statusCode(res.status),
        message: body.slice(0, 500) || undefined,
      },
    }
  }

  const data = (await res.json()) as AmplitudeSegmentationResponse
  return { ok: true, data }
}

/**
 * Collapse an event-segmentation payload into per-day counts. The shape is
 * documented as `series: [[ <int>, <int>, ... ]]` aligned with `xValues`,
 * but we defensively unwrap [ts, value] pairs in case Amplitude returns the
 * realtime variant.
 */
export function collapseSegmentation(
  eventName: string,
  payload: AmplitudeSegmentationResponse | null
): AmplitudeDailySeries {
  if (!payload?.data) {
    return {
      eventName,
      byDate: {},
      total: 0,
      error: {
        status: 0,
        code: "Empty response",
        message: "Amplitude returned no data block.",
      },
    }
  }

  const xValues = payload.data.xValues ?? []
  const rawSeries = payload.data.series ?? []
  const firstSeries = rawSeries[0] ?? []

  const byDate: Record<string, number> = {}
  let total = 0
  xValues.forEach((x, idx) => {
    const point = firstSeries[idx] as number | number[] | undefined
    const value = Array.isArray(point) ? point[point.length - 1] : point
    const num = typeof value === "number" && Number.isFinite(value) ? value : 0
    byDate[String(x)] = num
    total += num
  })

  const result: AmplitudeDailySeries = { eventName, byDate, total }
  if (xValues.length === 0) {
    result.error = {
      status: 200,
      code: "No data points",
      message: `Amplitude returned 200 but no xValues for "${eventName}". Verify the event name matches your taxonomy exactly (case + spaces).`,
    }
  }
  return result
}

/**
 * Convenience: fetch + collapse in one call. Always returns a result; when
 * the upstream call failed, `byDate` is empty and `error` is populated.
 */
export async function fetchAmplitudeEventDaily(
  clientId: string,
  eventName: string,
  from: string,
  to: string
): Promise<AmplitudeDailySeries> {
  const raw = await fetchAmplitudeSegmentation(clientId, eventName, from, to)
  if (!raw.ok) {
    return { eventName, byDate: {}, total: 0, error: raw.error }
  }
  return collapseSegmentation(eventName, raw.data)
}
