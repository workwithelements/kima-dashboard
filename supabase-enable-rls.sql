-- Migration: Enable Row-Level Security on all public tables
-- Fixes Supabase security advisory: rls_disabled_in_public
-- Safe to re-run: drops policies before recreating them.
-- Skips tables that don't exist yet.

DO $$ BEGIN

-- ============================================================
-- 1. clients
-- ============================================================
IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'clients') THEN
  ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "Service role full access on clients" ON clients;
  CREATE POLICY "Service role full access on clients"
    ON clients FOR ALL TO service_role USING (true);
  DROP POLICY IF EXISTS "Authenticated users can read clients" ON clients;
  CREATE POLICY "Authenticated users can read clients"
    ON clients FOR SELECT TO authenticated USING (true);
END IF;

-- ============================================================
-- 2. meta_daily_performance
-- ============================================================
IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'meta_daily_performance') THEN
  ALTER TABLE meta_daily_performance ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "Service role full access on meta_daily_performance" ON meta_daily_performance;
  CREATE POLICY "Service role full access on meta_daily_performance"
    ON meta_daily_performance FOR ALL TO service_role USING (true);
  DROP POLICY IF EXISTS "Authenticated users can read meta_daily_performance" ON meta_daily_performance;
  CREATE POLICY "Authenticated users can read meta_daily_performance"
    ON meta_daily_performance FOR SELECT TO authenticated USING (true);
END IF;

-- ============================================================
-- 3. meta_ad_metadata
-- ============================================================
IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'meta_ad_metadata') THEN
  ALTER TABLE meta_ad_metadata ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "Service role full access on meta_ad_metadata" ON meta_ad_metadata;
  CREATE POLICY "Service role full access on meta_ad_metadata"
    ON meta_ad_metadata FOR ALL TO service_role USING (true);
  DROP POLICY IF EXISTS "Authenticated users can read meta_ad_metadata" ON meta_ad_metadata;
  CREATE POLICY "Authenticated users can read meta_ad_metadata"
    ON meta_ad_metadata FOR SELECT TO authenticated USING (true);
END IF;

-- ============================================================
-- 4. meta_daily_demographics
-- ============================================================
IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'meta_daily_demographics') THEN
  ALTER TABLE meta_daily_demographics ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "Service role full access on meta_daily_demographics" ON meta_daily_demographics;
  CREATE POLICY "Service role full access on meta_daily_demographics"
    ON meta_daily_demographics FOR ALL TO service_role USING (true);
  DROP POLICY IF EXISTS "Authenticated users can read meta_daily_demographics" ON meta_daily_demographics;
  CREATE POLICY "Authenticated users can read meta_daily_demographics"
    ON meta_daily_demographics FOR SELECT TO authenticated USING (true);
END IF;

-- ============================================================
-- 5. meta_daily_placements
-- ============================================================
IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'meta_daily_placements') THEN
  ALTER TABLE meta_daily_placements ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "Service role full access on meta_daily_placements" ON meta_daily_placements;
  CREATE POLICY "Service role full access on meta_daily_placements"
    ON meta_daily_placements FOR ALL TO service_role USING (true);
  DROP POLICY IF EXISTS "Authenticated users can read meta_daily_placements" ON meta_daily_placements;
  CREATE POLICY "Authenticated users can read meta_daily_placements"
    ON meta_daily_placements FOR SELECT TO authenticated USING (true);
END IF;

-- ============================================================
-- 6. google_ads_daily_performance
-- ============================================================
IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'google_ads_daily_performance') THEN
  ALTER TABLE google_ads_daily_performance ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "Service role full access on google_ads_daily_performance" ON google_ads_daily_performance;
  CREATE POLICY "Service role full access on google_ads_daily_performance"
    ON google_ads_daily_performance FOR ALL TO service_role USING (true);
  DROP POLICY IF EXISTS "Authenticated users can read google_ads_daily_performance" ON google_ads_daily_performance;
  CREATE POLICY "Authenticated users can read google_ads_daily_performance"
    ON google_ads_daily_performance FOR SELECT TO authenticated USING (true);
END IF;

-- ============================================================
-- 7. client_scorecard_config
-- ============================================================
IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'client_scorecard_config') THEN
  ALTER TABLE client_scorecard_config ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "Service role full access on client_scorecard_config" ON client_scorecard_config;
  CREATE POLICY "Service role full access on client_scorecard_config"
    ON client_scorecard_config FOR ALL TO service_role USING (true);
  DROP POLICY IF EXISTS "Authenticated users can read client_scorecard_config" ON client_scorecard_config;
  CREATE POLICY "Authenticated users can read client_scorecard_config"
    ON client_scorecard_config FOR SELECT TO authenticated USING (true);
END IF;

-- ============================================================
-- 8. custom_metrics
-- ============================================================
IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'custom_metrics') THEN
  ALTER TABLE custom_metrics ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "Service role full access on custom_metrics" ON custom_metrics;
  CREATE POLICY "Service role full access on custom_metrics"
    ON custom_metrics FOR ALL TO service_role USING (true);
  DROP POLICY IF EXISTS "Authenticated users can manage custom_metrics" ON custom_metrics;
  CREATE POLICY "Authenticated users can manage custom_metrics"
    ON custom_metrics FOR ALL TO authenticated USING (true);
END IF;

-- ============================================================
-- 9. annotations
-- ============================================================
IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'annotations') THEN
  ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "Service role full access on annotations" ON annotations;
  CREATE POLICY "Service role full access on annotations"
    ON annotations FOR ALL TO service_role USING (true);
  DROP POLICY IF EXISTS "Authenticated users can manage annotations" ON annotations;
  CREATE POLICY "Authenticated users can manage annotations"
    ON annotations FOR ALL TO authenticated USING (true);
END IF;

-- ============================================================
-- 10. creative_tags
-- ============================================================
IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'creative_tags') THEN
  ALTER TABLE creative_tags ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "Service role full access on creative_tags" ON creative_tags;
  CREATE POLICY "Service role full access on creative_tags"
    ON creative_tags FOR ALL TO service_role USING (true);
  DROP POLICY IF EXISTS "Authenticated users can manage creative_tags" ON creative_tags;
  CREATE POLICY "Authenticated users can manage creative_tags"
    ON creative_tags FOR ALL TO authenticated USING (true);
END IF;

-- ============================================================
-- 11. creative_ad_tags
-- ============================================================
IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'creative_ad_tags') THEN
  ALTER TABLE creative_ad_tags ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "Service role full access on creative_ad_tags" ON creative_ad_tags;
  CREATE POLICY "Service role full access on creative_ad_tags"
    ON creative_ad_tags FOR ALL TO service_role USING (true);
  DROP POLICY IF EXISTS "Authenticated users can manage creative_ad_tags" ON creative_ad_tags;
  CREATE POLICY "Authenticated users can manage creative_ad_tags"
    ON creative_ad_tags FOR ALL TO authenticated USING (true);
END IF;

-- ============================================================
-- 12. view_sessions
-- ============================================================
IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'view_sessions') THEN
  ALTER TABLE view_sessions ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "Service role full access on view_sessions" ON view_sessions;
  CREATE POLICY "Service role full access on view_sessions"
    ON view_sessions FOR ALL TO service_role USING (true);
END IF;

END $$;
