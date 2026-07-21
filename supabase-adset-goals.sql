-- Migration: ad set optimisation goals + per-test key action override.
--
-- 1. meta_adset_goals caches each ad set's Meta optimisation goal
--    (optimization_goal + promoted_object.custom_event_type), fetched
--    lazily from the Graph API by the dashboard. Creative tests use the
--    mapped key_action as the DEFAULT optimisation event for tests in
--    that ad set.
-- 2. creative_tests.key_action_override lets an operator replace the
--    default with another conversion action for a specific test.

CREATE TABLE IF NOT EXISTS meta_adset_goals (
  adset_id           TEXT PRIMARY KEY,
  client_id          UUID REFERENCES clients(id) ON DELETE CASCADE,
  adset_name         TEXT,
  optimization_goal  TEXT,
  custom_event_type  TEXT,
  -- Mapped meta_daily_performance column (e.g. 'purchases'); null when the
  -- goal has no column equivalent.
  key_action         TEXT,
  fetched_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_adset_goals_client ON meta_adset_goals(client_id);

ALTER TABLE meta_adset_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on meta_adset_goals"
  ON meta_adset_goals FOR ALL TO service_role USING (true);
CREATE POLICY "Authenticated read on meta_adset_goals"
  ON meta_adset_goals FOR SELECT TO authenticated USING (true);

-- Per-test optimisation event override (replaces the ad set default)
ALTER TABLE creative_tests
  ADD COLUMN IF NOT EXISTS key_action_override TEXT;
