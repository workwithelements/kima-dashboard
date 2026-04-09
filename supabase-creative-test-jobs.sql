-- Migration: Creative Test Jobs — job queue for automated creative test analysis.
-- Each row represents a queued analysis task triggered by the UI or daily cron.

CREATE TABLE IF NOT EXISTS creative_test_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id     UUID REFERENCES creative_tests(id) ON DELETE CASCADE NOT NULL,
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  error       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_creative_test_jobs_status ON creative_test_jobs(status);
CREATE INDEX idx_creative_test_jobs_test ON creative_test_jobs(test_id);

-- RLS
ALTER TABLE creative_test_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on creative_test_jobs"
  ON creative_test_jobs FOR ALL TO service_role USING (true);
CREATE POLICY "Authenticated read on creative_test_jobs"
  ON creative_test_jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert on creative_test_jobs"
  ON creative_test_jobs FOR INSERT TO authenticated WITH CHECK (true);
