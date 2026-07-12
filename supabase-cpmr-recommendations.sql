-- Migration: CPMr report recommendation feedback
-- Stores the team's response to each recommended action (scale / pause /
-- protect) from the Reach Analysis CPMr report. One row per resolved
-- recommendation. Acceptance rates aggregated across ALL clients weight
-- future recommendation ranking, so the panel learns which action types the
-- team actually acts on.

CREATE TABLE IF NOT EXISTS cpmr_recommendation_feedback (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  ad_id        TEXT NOT NULL,
  ad_name      TEXT,
  action_type  TEXT NOT NULL CHECK (action_type IN ('scale', 'pause', 'protect')),
  window_key   TEXT NOT NULL,
  -- Metric snapshot at the moment the recommendation was resolved
  -- (spend, reach, cpmr, cpa, roas + the thresholds that produced it)
  metrics      JSONB,
  status       TEXT NOT NULL CHECK (status IN ('actioned', 'dismissed')),
  -- Free-text "why" from the team — the qualitative half of the loop
  feedback     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, ad_id, action_type)
);

CREATE INDEX IF NOT EXISTS idx_cpmr_feedback_client
  ON cpmr_recommendation_feedback(client_id);
CREATE INDEX IF NOT EXISTS idx_cpmr_feedback_type_status
  ON cpmr_recommendation_feedback(action_type, status);
