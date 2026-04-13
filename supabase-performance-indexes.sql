-- Migration: Performance indexes for dashboard queries
--
-- The most common query pattern across the dashboard is:
--   WHERE client_id = ? AND date BETWEEN ? AND ?
--
-- Without composite indexes, every query does a full scan or relies on
-- single-column indexes that can't be used together efficiently. These
-- indexes should give 10-100x speed-ups on dashboard page loads.
--
-- Run this in Supabase SQL Editor.

-- Meta daily performance — the main dashboard query target
CREATE INDEX IF NOT EXISTS idx_meta_daily_perf_client_date
  ON meta_daily_performance (client_id, date);

-- Filter by adset / campaign within a client (for drill-down / filtering)
CREATE INDEX IF NOT EXISTS idx_meta_daily_perf_client_adset
  ON meta_daily_performance (client_id, adset_id);
CREATE INDEX IF NOT EXISTS idx_meta_daily_perf_client_campaign
  ON meta_daily_performance (client_id, campaign_id);

-- Lookup ad metadata by client + creation date (for the test badge)
CREATE INDEX IF NOT EXISTS idx_meta_ad_metadata_client_created
  ON meta_ad_metadata (client_id, created_time);

-- Demographics & placements — same client + date pattern
CREATE INDEX IF NOT EXISTS idx_meta_daily_demographics_client_date
  ON meta_daily_demographics (client_id, date);
CREATE INDEX IF NOT EXISTS idx_meta_daily_placements_client_date
  ON meta_daily_placements (client_id, date);

-- Google Ads daily performance (if table exists — wrap in DO block to skip silently)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'google_ads_daily_performance') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_google_ads_daily_perf_client_date ON google_ads_daily_performance (client_id, date)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_google_ads_daily_perf_client_campaign ON google_ads_daily_performance (client_id, campaign_id)';
  END IF;
END $$;

-- Shopify daily orders (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'shopify_daily_orders') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shopify_daily_orders_client_date ON shopify_daily_orders (client_id, date)';
  END IF;
END $$;

-- Creative tests — find tests by client + status
CREATE INDEX IF NOT EXISTS idx_creative_tests_client
  ON creative_tests (client_id, status);

-- Update query planner statistics
ANALYZE meta_daily_performance;
ANALYZE meta_ad_metadata;
ANALYZE meta_daily_demographics;
ANALYZE meta_daily_placements;
