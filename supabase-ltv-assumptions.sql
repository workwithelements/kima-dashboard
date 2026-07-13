-- Migration: client_ltv_assumptions table
-- One row per client holding the subscription-LTV model assumptions used by
-- the Unit Economics view (currently Alexia only). Prices are in the
-- client's account currency; rates/discount/margin/mix are fractions (0-1),
-- not percentages. Defaults seed the validated model; they are refreshed
-- periodically from Baremetrics exports via the Assumptions panel.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS client_ltv_assumptions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID REFERENCES clients(id) ON DELETE CASCADE UNIQUE,
  -- Annual plan
  annual_y1_upfront    NUMERIC(10,2) NOT NULL DEFAULT 180.00,
  annual_renewal_price NUMERIC(10,2) NOT NULL DEFAULT 249.99,
  year2_renewal_rate   NUMERIC(6,4)  NOT NULL DEFAULT 0.55,
  year3_renewal_rate   NUMERIC(6,4)  NOT NULL DEFAULT 0.32,
  -- Monthly plan
  monthly_price        NUMERIC(10,2) NOT NULL DEFAULT 29.99,
  first_month_discount NUMERIC(6,4)  NOT NULL DEFAULT 0.40,
  monthly_median_ltv   NUMERIC(10,2) NOT NULL DEFAULT 160.00,
  -- Targets
  target_margin        NUMERIC(6,4)  NOT NULL DEFAULT 0.20,
  ltv_cac_target       NUMERIC(6,2)  NOT NULL DEFAULT 3.0,
  horizon_months       INTEGER       NOT NULL DEFAULT 24,
  -- Manual account-level annual mix used for ads with no per-ad
  -- applications_submitted data (e.g. before the Meta sync writes it).
  fallback_annual_mix  NUMERIC(6,4)  NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ DEFAULT now(),
  updated_by           TEXT
);

ALTER TABLE client_ltv_assumptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on client_ltv_assumptions"
  ON client_ltv_assumptions FOR ALL TO service_role USING (true);
