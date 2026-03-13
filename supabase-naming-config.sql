-- Migration: client_naming_config table
-- Stores per-client naming convention mapping for ad name parsing.
-- Each row maps underscore positions to dimension keys/labels,
-- plus optional code→label value maps per dimension.

CREATE TABLE IF NOT EXISTS client_naming_config (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID REFERENCES clients(id) ON DELETE CASCADE UNIQUE,
  positions  JSONB NOT NULL DEFAULT '[]',
  -- Array of { "index": 0, "key": "format", "label": "Format" }
  value_maps JSONB NOT NULL DEFAULT '{}',
  -- Map of dimension key → code→label dict, e.g. { "landingPage": { "PP": "Product Page" } }
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE client_naming_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on client_naming_config"
  ON client_naming_config FOR ALL TO service_role USING (true);
