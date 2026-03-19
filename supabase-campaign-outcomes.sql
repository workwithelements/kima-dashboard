-- Campaign Outcomes: per-campaign outcome metric overrides
-- Allows assigning specific outcome metrics to individual campaigns
-- so the Performance view adapts when drilling into those campaigns.

CREATE TABLE IF NOT EXISTS client_campaign_outcomes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,  -- cached for display in settings
  outcome_key TEXT NOT NULL,  -- FunnelStepKey: 'purchases', 'app_installs', 'mobile_app_registrations', etc.
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, campaign_id)
);

-- Index for fast lookup by client
CREATE INDEX IF NOT EXISTS idx_campaign_outcomes_client
  ON client_campaign_outcomes(client_id);

-- RLS policies
ALTER TABLE client_campaign_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on campaign_outcomes"
  ON client_campaign_outcomes
  FOR ALL
  USING (true)
  WITH CHECK (true);
