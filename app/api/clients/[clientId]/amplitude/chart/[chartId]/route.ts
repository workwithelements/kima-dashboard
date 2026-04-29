import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/authorize"
import { fetchNormalisedAmplitudeChart } from "@/lib/data/fetch-amplitude-data"

/**
 * GET /api/clients/[clientId]/amplitude/chart/[chartId]
 *
 * Proxies an Amplitude saved-chart query so the API key/secret never leaves
 * the server. Returns a recharts-friendly `points` array.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientId: string; chartId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  if (!params.chartId.match(/^[a-zA-Z0-9]+$/)) {
    return NextResponse.json({ error: "Invalid chart id" }, { status: 400 })
  }

  const result = await fetchNormalisedAmplitudeChart(params.clientId, params.chartId)
  return NextResponse.json(result)
}
