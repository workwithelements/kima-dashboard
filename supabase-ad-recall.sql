-- Migration: Ad Recall Lift (Meta)
-- Adds the estimated_ad_recallers count to meta_daily_performance so it can
-- be selected as a TOF funnel step in the scorecard config.
--
-- estimated_ad_recallers is Meta's modelled count of people likely to remember
-- the ad within 2 days of seeing it. The "recall lift rate" is derived as
-- recallers / reach at render-time, matching Meta's estimated_ad_recall_rate.
--
-- The Meta sync job that populates meta_daily_performance must be updated
-- separately to read `estimated_ad_recallers` from the Marketing API insights
-- and write into this column. Until then, values stay at the default 0.

ALTER TABLE meta_daily_performance
  ADD COLUMN IF NOT EXISTS estimated_ad_recallers INTEGER NOT NULL DEFAULT 0;
