-- Soft-delete for creative tests: lets operators hide irrelevant detections
-- (e.g. ads grouped by an accidental shared concept name) without losing the
-- row. kima-sync's upsert touches the columns it knows about; adding this
-- new column means dismissals survive re-detection.

ALTER TABLE creative_tests
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_creative_tests_client_dismissed
  ON creative_tests (client_id, dismissed_at);
