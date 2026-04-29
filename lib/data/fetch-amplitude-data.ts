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

export type NormalisedAmplitudeChart = {
  chartId: string
  xValues: string[]
  seriesLabels: string[]
  points: AmplitudeSeriesPoint[]
}

type AmplitudeCredentials = {
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

/**
 * Query a saved chart by its ID.
 *
 * Returns the raw Amplitude response — call `normaliseChart` to flatten it
 * into a recharts-friendly array.
 */
export async function fetchAmplitudeChart(
  clientId: string,
  chartId: string
): Promise<AmplitudeChartResponse | null> {
  const creds = await getCredentials(clientId)
  if (!creds) return null

  const auth = Buffer.from(`${creds.apiKey}:${creds.secretKey}`).toString("base64")
  const res = await fetch(`${AMPLITUDE_BASE}/chart/${chartId}/query`, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
    // Amplitude rate-limits to 360 queries/hour per project, so cache briefly
    // when this is hit from multiple components in the same render.
    next: { revalidate: 60 },
  })

  if (!res.ok) {
    console.error(
      "[Amplitude] Chart query failed",
      chartId,
      res.status,
      await res.text().catch(() => "")
    )
    return null
  }

  return (await res.json()) as AmplitudeChartResponse
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
    return { chartId, xValues: [], seriesLabels: [], points: [] }
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
      const key = seriesLabels[sIdx] ? `series_${sIdx}` : `series_${sIdx}`
      row[key] = typeof value === "number" ? value : 0
    })
    return row
  })

  return {
    chartId,
    xValues,
    seriesLabels: seriesLabels.length > 0
      ? seriesLabels
      : rawSeries.map((_, i) => `Series ${i + 1}`),
    points,
  }
}

/**
 * Convenience: fetch and normalise in one call.
 */
export async function fetchNormalisedAmplitudeChart(
  clientId: string,
  chartId: string
): Promise<NormalisedAmplitudeChart> {
  const raw = await fetchAmplitudeChart(clientId, chartId)
  return normaliseChart(chartId, raw)
}
