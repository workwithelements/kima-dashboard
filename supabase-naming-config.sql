-- Migration: client_naming_config table
-- Stores per-client naming convention mapping for ad name parsing.
-- Each row maps positions in the (separator-delimited) ad name to
-- dimension keys/labels, plus optional code→label value maps per dimension.

CREATE TABLE IF NOT EXISTS client_naming_config (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID REFERENCES clients(id) ON DELETE CASCADE UNIQUE,
  positions  JSONB NOT NULL DEFAULT '[]',
  -- Array of { "index": 0, "key": "format", "label": "Format" }
  value_maps JSONB NOT NULL DEFAULT '{}',
  -- Map of dimension key → code→label dict, e.g. { "landingPage": { "PP": "Product Page" } }
  separator  TEXT NOT NULL DEFAULT '_',
  -- Delimiter between segments in ad names. Defaults to underscore.
  -- Set to e.g. ' // ' for clients that use a different convention.
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Backfill for existing deployments: add the column if it didn't exist before.
ALTER TABLE client_naming_config
  ADD COLUMN IF NOT EXISTS separator TEXT NOT NULL DEFAULT '_';

ALTER TABLE client_naming_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on client_naming_config"
  ON client_naming_config FOR ALL TO service_role USING (true);
