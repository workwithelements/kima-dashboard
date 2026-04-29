/**
 * Server-side fetcher for Amplitude's Dashboard REST API.
 *
 * Docs: https://amplitude.com/docs/apis/analytics/dashboard-rest
 *
 * Each Amplitude project has its own API key + secret key (Basic auth).
 * Credentials are stored per client on the `clients` row.
 */

import { createServiceClient } from "@/lib/supabase/server"

const AMPLITUDE_BASE = "https://amplitude.com/api/3"
/** EU residency endpoint — flip per-client if you ever onboard EU projects. */
// const AMPLITUDE_BASE_EU = "https://analytics.eu.amplitude.com/api/3"

export type AmplitudeChartResponse = {
  data: {
    series?: number[][][]
    seriesLabels?: Array<string | number>
    seriesMeta?: unknown[]
    xValues?: string[]
    [key: string]: unknown
  }
}

/** Normalised shape consumed by the recharts widget. */
export type AmplitudeSeriesPoint = {
  x: string
  /** Each saved series gets its own key (`series_0`, `series_1`, …). */
  [seriesKey: string]: string | number
}

export type AmplitudeFetchError = {
  /** HTTP status from Amplitude (0 when the call never reached the server) */
  status: number
  /** Short human-readable label, e.g. "Unauthorized", "No credentials" */
  code: string
  /** Optional verbose message from the upstream response or thrown error */
  message?: string
}

export type NormalisedAmplitudeChart = {
  chartId: string
  xValues: string[]
  seriesLabels: string[]
  points: AmplitudeSeriesPoint[]
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

/**
 * Low-level chart query. Returns either the raw Amplitude payload or a
 * structured error so the caller can surface a useful message.
 */
export async function fetchAmplitudeChart(
  clientId: string,
  chartId: string,
  credsOverride?: AmplitudeCredentials
): Promise<
  | { ok: true; data: AmplitudeChartResponse }
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

  let res: Response
  try {
    res = await fetch(`${AMPLITUDE_BASE}/chart/${chartId}/query`, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      // Amplitude rate-limits to 360 queries/hour per project, so cache briefly
      // when this is hit from multiple components in the same render.
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
    console.error("[Amplitude] Chart query failed", chartId, res.status, body)
    return {
      ok: false,
      error: {
        status: res.status,
        code: statusCode(res.status),
        message: body.slice(0, 500) || undefined,
      },
    }
  }

  const data = (await res.json()) as AmplitudeChartResponse
  return { ok: true, data }
}

/**
 * Flatten an Amplitude chart payload into the per-x-value rows recharts expects.
 *
 * Amplitude returns `series` as `[ [ [y, ...], [y, ...] ], ... ]` where the
 * outer index is the series and the inner pairs/values map onto `xValues`.
 * We collapse that to one object per x value with one key per series.
 */
export function normaliseChart(
  chartId: string,
  payload: AmplitudeChartResponse | null
): NormalisedAmplitudeChart {
  if (!payload?.data) {
    return {
      chartId,
      xValues: [],
      seriesLabels: [],
      points: [],
      error: { status: 0, code: "Empty response", message: "Amplitude returned no data block." },
    }
  }

  const xValues = payload.data.xValues ?? []
  const rawSeries = payload.data.series ?? []
  const seriesLabels = (payload.data.seriesLabels ?? []).map(String)

  const points: AmplitudeSeriesPoint[] = xValues.map((x, xIdx) => {
    const row: AmplitudeSeriesPoint = { x }
    rawSeries.forEach((series, sIdx) => {
      const point = series[xIdx]
      // Amplitude wraps each y as [value] or [timestamp, value] depending on chart type
      const value = Array.isArray(point) ? point[point.length - 1] : point
      row[`series_${sIdx}`] = typeof value === "number" ? value : 0
    })
    return row
  })

  const result: NormalisedAmplitudeChart = {
    chartId,
    xValues,
    seriesLabels: seriesLabels.length > 0
      ? seriesLabels
      : rawSeries.map((_, i) => `Series ${i + 1}`),
    points,
  }

  if (xValues.length === 0 || rawSeries.length === 0) {
    result.error = {
      status: 200,
      code: "No series in response",
      message:
        "Amplitude returned 200 but no xValues/series. The chart may be a Funnel/" +
        "Pathfinder type whose payload shape this normaliser doesn't support yet.",
    }
  }

  return result
}

/**
 * Convenience: fetch and normalise in one call. Always returns a result; when
 * the upstream call failed, `points` is empty and `error` is populated.
 */
export async function fetchNormalisedAmplitudeChart(
  clientId: string,
  chartId: string
): Promise<NormalisedAmplitudeChart> {
  const raw = await fetchAmplitudeChart(clientId, chartId)
  if (!raw.ok) {
    return {
      chartId,
      xValues: [],
      seriesLabels: [],
      points: [],
      error: raw.error,
    }
  }
  return normaliseChart(chartId, raw.data)
}
