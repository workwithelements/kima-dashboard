-- Migration: Trials Started (Meta)
-- Adds the start_trial action count to meta_daily_performance so it can be
-- selected as a funnel step in the scorecard config.
--
-- The Meta sync job that populates meta_daily_performance must be updated
-- separately to read `actions[action_type=start_trial]` from the Marketing
-- API and write into this column. Until then, values stay at the default 0.

ALTER TABLE meta_daily_performance
  ADD COLUMN IF NOT EXISTS trials_started INTEGER NOT NULL DEFAULT 0;
