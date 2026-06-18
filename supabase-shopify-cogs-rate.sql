-- Per-client COGS rate so CM3 stays consistent across re-syncs without
-- having to remember --cogs-rate on every CLI invocation.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS shopify_cogs_rate NUMERIC;

ALTER TABLE clients
  ADD CONSTRAINT shopify_cogs_rate_range CHECK (
    shopify_cogs_rate IS NULL OR (shopify_cogs_rate >= 0 AND shopify_cogs_rate <= 1)
  );

COMMENT ON COLUMN clients.shopify_cogs_rate IS
  'Default COGS rate (0-1) used when syncing Shopify orders. cogs = gross_revenue * shopify_cogs_rate. Override per-run with the --cogs-rate CLI flag.';
