-- Add creative_id column to meta_ad_metadata
-- This stores the Meta creative ID so we can re-fetch fresh thumbnail URLs
-- (Meta CDN URLs expire after ~24 hours)

ALTER TABLE meta_ad_metadata
ADD COLUMN IF NOT EXISTS creative_id TEXT;

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_meta_ad_metadata_creative_id
ON meta_ad_metadata(creative_id);
