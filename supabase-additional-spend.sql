-- Migration: client_additional_spend table
-- Manually-entered off-platform spend (TV, billboards, sponsorships, retainers, etc.)
-- that is layered on top of platform spend for the budgeting/pacing pages only.
-- The amount is the total for the [start_date, end_date] range and is split
-- evenly across days at read time (no daily materialisation).

CREATE TABLE IF NOT EXISTS client_additional_spend (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  amount      NUMERIC NOT NULL CHECK (amount >= 0),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_additional_spend_client_dates
  ON client_additional_spend(client_id, start_date, end_date);

ALTER TABLE client_additional_spend ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on client_additional_spend"
  ON client_additional_spend;
CREATE POLICY "Service role full access on client_additional_spend"
  ON client_additional_spend FOR ALL TO service_role USING (true);
