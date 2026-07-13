-- Migration: Applications Submitted (Meta)
-- Adds the applications-submitted action count to meta_daily_performance.
-- Used by the Unit Economics view (Alexia) as the annual-plan conversion
-- count — a subset of `purchases`, never additive with it.
--
-- The Meta sync job that populates meta_daily_performance (kima-sync repo)
-- must be updated separately to read the applications-submitted action from
-- the Marketing API and write into this column.
--
-- Deliberately NULLable with NO default (unlike trials_started): the
-- dashboard needs to distinguish "not synced yet" (NULL → fall back to the
-- configured account annual mix) from a genuine 0 (a real 0% annual mix).
--
-- Run this in the Supabase SQL Editor.

ALTER TABLE meta_daily_performance
  ADD COLUMN IF NOT EXISTS applications_submitted INTEGER;
