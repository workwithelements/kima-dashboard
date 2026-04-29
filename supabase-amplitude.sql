-- Migration: Amplitude Dashboard Integration
-- Stores per-client Amplitude credentials and the list of saved chart IDs
-- to surface in the dashboard. Charts are queried live via Amplitude's
-- Dashboard REST API (https://amplitude.com/docs/apis/analytics/dashboard-rest).

-- 1. Per-client Amplitude config
ALTER TABLE clients ADD COLUMN IF NOT EXISTS amplitude_org TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS amplitude_api_key TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS amplitude_secret_key TEXT;

-- 2. Saved Amplitude charts to render on the client dashboard
CREATE TABLE IF NOT EXISTS amplitude_charts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  chart_id     TEXT NOT NULL,
  title        TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT uq_amplitude_charts UNIQUE (client_id, chart_id)
);

CREATE INDEX IF NOT EXISTS idx_amplitude_charts_client ON amplitude_charts(client_id, position);

-- 3. RLS
ALTER TABLE amplitude_charts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on amplitude_charts"
  ON amplitude_charts FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated read on amplitude_charts"
  ON amplitude_charts FOR SELECT TO authenticated USING (true);
