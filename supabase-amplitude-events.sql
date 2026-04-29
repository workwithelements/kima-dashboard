-- Migration: Amplitude Event Segmentation
-- Replaces the saved-chart approach (which broke for Funnel/Pathfinder/Cohort
-- chart types whose response shape doesn't match the time-series parser) with
-- per-client tracked event names. Counts are pulled live via Amplitude's
-- Dashboard REST API (/2/events/segmentation), which always returns a
-- predictable { xValues, series:[counts] } shape.

CREATE TABLE IF NOT EXISTS amplitude_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  event_name      TEXT NOT NULL,
  display_title   TEXT,
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT uq_amplitude_events UNIQUE (client_id, event_name)
);

CREATE INDEX IF NOT EXISTS idx_amplitude_events_client
  ON amplitude_events(client_id, position);

ALTER TABLE amplitude_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on amplitude_events"
  ON amplitude_events FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated read on amplitude_events"
  ON amplitude_events FOR SELECT TO authenticated USING (true);
