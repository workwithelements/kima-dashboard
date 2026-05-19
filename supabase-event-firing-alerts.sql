-- Migration: Event Firing Silence Tracker
-- Records which (client_id, event_name) pairs are currently "silent" —
-- i.e. fired 0 times yesterday despite >0 firings in the prior 7 days.
-- The cron job uses this row as a state machine so we only alert on the
-- transition from healthy → silent (no daily re-spam), and so we can log
-- when the event recovers.

CREATE TABLE IF NOT EXISTS event_firing_silence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  event_name      TEXT NOT NULL,
  baseline_7d     NUMERIC NOT NULL,
  silent_since    DATE NOT NULL,
  alerted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  recovered_at    TIMESTAMPTZ,

  CONSTRAINT uq_event_firing_silence UNIQUE (client_id, event_name, silent_since)
);

CREATE INDEX IF NOT EXISTS idx_event_firing_silence_active
  ON event_firing_silence(client_id, event_name)
  WHERE recovered_at IS NULL;

ALTER TABLE event_firing_silence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on event_firing_silence"
  ON event_firing_silence FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated read on event_firing_silence"
  ON event_firing_silence FOR SELECT TO authenticated USING (true);
