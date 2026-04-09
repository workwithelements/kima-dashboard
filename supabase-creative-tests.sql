-- Migration: Creative Tests — test detection, analysis results, and per-client config.
-- Enables automated creative A/B test tracking from synced Meta Ads data.

-- 1. Per-client config (thresholds + Notion board)
CREATE TABLE IF NOT EXISTS creative_test_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL UNIQUE,
  enabled           BOOLEAN NOT NULL DEFAULT false,
  min_days_live     INTEGER NOT NULL DEFAULT 5,
  min_spend         NUMERIC NOT NULL DEFAULT 100,
  min_conversions   INTEGER NOT NULL DEFAULT 10,
  high_spend_alert  NUMERIC NOT NULL DEFAULT 150,
  notion_board_id   TEXT,
  slack_channel_id  TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- 2. Detected creative tests (one row per concept-per-adset)
CREATE TABLE IF NOT EXISTS creative_tests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  concept_name      TEXT NOT NULL,
  adset_id          TEXT NOT NULL,
  adset_name        TEXT,
  campaign_id       TEXT,
  variant_ad_ids    TEXT[] NOT NULL DEFAULT '{}',
  variant_count     INTEGER NOT NULL DEFAULT 0,
  first_live_date   DATE,
  days_live         INTEGER DEFAULT 0,
  total_spend       NUMERIC DEFAULT 0,
  total_conversions INTEGER DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'monitoring'
                    CHECK (status IN ('monitoring', 'ready', 'analysed', 'flagged')),
  outcome           TEXT CHECK (outcome IN ('win', 'lose', 'inconclusive')),
  ready_at          TIMESTAMPTZ,
  analysed_at       TIMESTAMPTZ,
  notion_page_id    TEXT,
  notion_page_url   TEXT,
  notion_matched    BOOLEAN DEFAULT false,
  flag_reason       TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT creative_tests_unique UNIQUE (client_id, concept_name, adset_id)
);

-- 3. Per-variant analysis results (populated when test reaches 'analysed')
CREATE TABLE IF NOT EXISTS creative_test_results (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id               UUID REFERENCES creative_tests(id) ON DELETE CASCADE NOT NULL,
  ad_id                 TEXT NOT NULL,
  ad_name               TEXT,
  hook_label            TEXT,
  spend                 NUMERIC DEFAULT 0,
  impressions           INTEGER DEFAULT 0,
  landing_page_views    INTEGER DEFAULT 0,
  adds_to_cart          INTEGER DEFAULT 0,
  checkouts_initiated   INTEGER DEFAULT 0,
  purchases             INTEGER DEFAULT 0,
  purchase_value        NUMERIC DEFAULT 0,
  cpa                   NUMERIC,
  roas                  NUMERIC,
  landing_rate          NUMERIC,
  cart_rate             NUMERIC,
  purchase_rate         NUMERIC,
  spend_share           NUMERIC,
  classification        TEXT,
  fatigue_status        TEXT,
  is_best_variant       BOOLEAN DEFAULT false,
  recent_spend          NUMERIC DEFAULT 0,
  recent_conversions    INTEGER DEFAULT 0,
  recent_cpa            NUMERIC,
  created_at            TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT creative_test_results_unique UNIQUE (test_id, ad_id)
);

-- 4. Indexes
CREATE INDEX idx_creative_tests_client_status ON creative_tests(client_id, status);
CREATE INDEX idx_creative_tests_updated ON creative_tests(updated_at DESC);
CREATE INDEX idx_creative_test_results_test ON creative_test_results(test_id);

-- 5. RLS
ALTER TABLE creative_test_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_test_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on creative_test_config"
  ON creative_test_config FOR ALL TO service_role USING (true);
CREATE POLICY "Service role full access on creative_tests"
  ON creative_tests FOR ALL TO service_role USING (true);
CREATE POLICY "Service role full access on creative_test_results"
  ON creative_test_results FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated read on creative_test_config"
  ON creative_test_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read on creative_tests"
  ON creative_tests FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read on creative_test_results"
  ON creative_test_results FOR SELECT TO authenticated USING (true);

-- Authenticated users can update creative_tests (for manual Notion linking)
CREATE POLICY "Authenticated update on creative_tests"
  ON creative_tests FOR UPDATE TO authenticated USING (true);

-- Authenticated users can manage config
CREATE POLICY "Authenticated write on creative_test_config"
  ON creative_test_config FOR ALL TO authenticated USING (true);
