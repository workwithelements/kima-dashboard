-- Migration: Meta Ad Creative Previews
-- Caches the HTML returned by Meta's /{creative-id}/previews endpoint so we
-- don't hit the Graph API on every modal open. Keyed by (ad_id, format) since
-- the same creative renders differently per placement.
--
-- TTL is enforced in the API route (24h) by checking fetched_at; this table
-- intentionally has no automatic expiry so a stale preview is still better
-- than nothing if Meta's API is briefly unavailable.

CREATE TABLE IF NOT EXISTS meta_ad_creative_previews (
  ad_id      TEXT        NOT NULL,
  format     TEXT        NOT NULL,
  html       TEXT        NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ad_id, format)
);

CREATE INDEX IF NOT EXISTS meta_ad_creative_previews_fetched_at_idx
  ON meta_ad_creative_previews (fetched_at);
