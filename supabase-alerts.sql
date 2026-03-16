-- Migration: Client Alert Configuration + Alert History
-- Stores per-client alert rules and a log of triggered alerts.

-- 1. Alert rule definitions (many per client)
CREATE TABLE IF NOT EXISTS client_alert_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  metric          TEXT NOT NULL,
  threshold_pct   NUMERIC NOT NULL CHECK (threshold_pct > 0),
  direction       TEXT NOT NULL DEFAULT 'either'
                  CHECK (direction IN ('increase', 'decrease', 'either')),
  slack_channel   TEXT NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_alert_config_client ON client_alert_config(client_id) WHERE enabled = true;

-- 2. Alert history log (append-only)
CREATE TABLE IF NOT EXISTS alert_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_config_id UUID REFERENCES client_alert_config(id) ON DELETE SET NULL,
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  metric          TEXT NOT NULL,
  direction       TEXT NOT NULL,
  threshold_pct   NUMERIC NOT NULL,
  actual_pct      NUMERIC NOT NULL,
  yesterday_value NUMERIC NOT NULL,
  avg_7d_value    NUMERIC NOT NULL,
  slack_channel   TEXT NOT NULL,
  slack_sent      BOOLEAN NOT NULL DEFAULT false,
  error_message   TEXT,
  triggered_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_alert_log_client_date ON alert_log(client_id, triggered_at DESC);

-- 3. RLS
ALTER TABLE client_alert_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on client_alert_config"
  ON client_alert_config FOR ALL TO service_role USING (true);

CREATE POLICY "Service role full access on alert_log"
  ON alert_log FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated read on client_alert_config"
  ON client_alert_config FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated read on alert_log"
  ON alert_log FOR SELECT TO authenticated USING (true);
