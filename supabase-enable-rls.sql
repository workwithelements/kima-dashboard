-- Migration: Enable Row-Level Security on all public tables
-- Fixes Supabase security advisory: rls_disabled_in_public
-- Tables that already have RLS (from prior migrations):
--   client_alert_config, alert_log, creative_test_config,
--   creative_tests, creative_test_results, client_naming_config

-- ============================================================
-- 1. clients
-- ============================================================
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on clients"
  ON clients FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated users can read clients"
  ON clients FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 2. meta_daily_performance
-- ============================================================
ALTER TABLE meta_daily_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on meta_daily_performance"
  ON meta_daily_performance FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated users can read meta_daily_performance"
  ON meta_daily_performance FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 3. meta_ad_metadata
-- ============================================================
ALTER TABLE meta_ad_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on meta_ad_metadata"
  ON meta_ad_metadata FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated users can read meta_ad_metadata"
  ON meta_ad_metadata FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 4. meta_daily_demographics
-- ============================================================
ALTER TABLE meta_daily_demographics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on meta_daily_demographics"
  ON meta_daily_demographics FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated users can read meta_daily_demographics"
  ON meta_daily_demographics FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 5. meta_daily_placements
-- ============================================================
ALTER TABLE meta_daily_placements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on meta_daily_placements"
  ON meta_daily_placements FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated users can read meta_daily_placements"
  ON meta_daily_placements FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 6. google_ads_daily_performance
-- ============================================================
ALTER TABLE google_ads_daily_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on google_ads_daily_performance"
  ON google_ads_daily_performance FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated users can read google_ads_daily_performance"
  ON google_ads_daily_performance FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 7. client_scorecard_config
-- ============================================================
ALTER TABLE client_scorecard_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on client_scorecard_config"
  ON client_scorecard_config FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated users can read client_scorecard_config"
  ON client_scorecard_config FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 8. custom_metrics
-- ============================================================
ALTER TABLE custom_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on custom_metrics"
  ON custom_metrics FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated users can read custom_metrics"
  ON custom_metrics FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage custom_metrics"
  ON custom_metrics FOR ALL TO authenticated USING (true);

-- ============================================================
-- 9. annotations
-- ============================================================
ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on annotations"
  ON annotations FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated users can read annotations"
  ON annotations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage annotations"
  ON annotations FOR ALL TO authenticated USING (true);

-- ============================================================
-- 10. creative_tags
-- ============================================================
ALTER TABLE creative_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on creative_tags"
  ON creative_tags FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated users can read creative_tags"
  ON creative_tags FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage creative_tags"
  ON creative_tags FOR ALL TO authenticated USING (true);

-- ============================================================
-- 11. creative_ad_tags
-- ============================================================
ALTER TABLE creative_ad_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on creative_ad_tags"
  ON creative_ad_tags FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated users can read creative_ad_tags"
  ON creative_ad_tags FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage creative_ad_tags"
  ON creative_ad_tags FOR ALL TO authenticated USING (true);

-- ============================================================
-- 12. view_sessions
-- ============================================================
ALTER TABLE view_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on view_sessions"
  ON view_sessions FOR ALL TO service_role USING (true);
