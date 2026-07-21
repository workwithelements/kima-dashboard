import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { requireAuth, safeError } from "@/lib/auth/authorize"

/**
 * POST /api/creative-tests/[testId]/analyze — queue an analysis job for a creative test.
 *
 * Creates a row in creative_test_jobs with status "pending".
 * The worker script (scripts/run-test-analysis.ts) picks up pending jobs.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { testId: string } }
) {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const db = createServiceClient()

  // Verify the test exists and is in "ready" status
  const { data: test, error: testError } = await db
    .from("creative_tests")
    .select("id, client_id, status, concept_name")
    .eq("id", params.testId)
    .single()

  if (testError || !test) {
    return NextResponse.json({ error: "Test not found" }, { status: 404 })
  }

  // "ready" is stamped by kima-sync, but the dashboard also computes
  // readiness itself per the scan rule (days AND (spend OR conversions)) —
  // possibly against a different optimisation event — so operator-initiated
  // analysis of a still-"monitoring" test is allowed. Only already-analysed
  // or flagged tests are refused.
  if (test.status !== "ready" && test.status !== "monitoring") {
    return NextResponse.json(
      { error: `Test is not ready for analysis (status: ${test.status})` },
      { status: 400 }
    )
  }

  // Check no pending/running job already exists for this test
  const { data: existing } = await db
    .from("creative_test_jobs")
    .select("id, status")
    .eq("test_id", params.testId)
    .in("status", ["pending", "running"])
    .limit(1)

  if (existing && existing.length > 0) {
    return NextResponse.json(
      { jobId: existing[0].id, status: existing[0].status, message: "Analysis already queued" },
      { status: 200 }
    )
  }

  // Create the job
  const { data: job, error: jobError } = await db
    .from("creative_test_jobs")
    .insert({
      test_id: params.testId,
      client_id: test.client_id,
      status: "pending",
    })
    .select("id, status")
    .single()

  if (jobError) return safeError(jobError)

  return NextResponse.json({ jobId: job.id, status: "queued" }, { status: 201 })
}
