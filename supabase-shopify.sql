-- Migration: Shopify Data Integration
-- Adds daily order aggregates and UTM-based attribution data for Shopify stores.

-- 1. Add Shopify store domain to clients table
ALTER TABLE clients ADD COLUMN IF NOT EXISTS shopify_store_domain TEXT;

-- 2. Daily order aggregates from Shopify
CREATE TABLE IF NOT EXISTS shopify_daily_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  date            DATE NOT NULL,
  orders          INTEGER NOT NULL DEFAULT 0,
  gross_revenue   NUMERIC NOT NULL DEFAULT 0,
  discounts       NUMERIC NOT NULL DEFAULT 0,
  refunds         NUMERIC NOT NULL DEFAULT 0,
  net_revenue     NUMERIC NOT NULL DEFAULT 0,
  cogs            NUMERIC NOT NULL DEFAULT 0,
  shipping_costs  NUMERIC NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT uq_shopify_daily_orders UNIQUE (client_id, date)
);

CREATE INDEX idx_shopify_daily_orders_client_date ON shopify_daily_orders(client_id, date);

-- 3. Daily attribution by UTM source/medium from Shopify
CREATE TABLE IF NOT EXISTS shopify_daily_attribution (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  date            DATE NOT NULL,
  source          TEXT NOT NULL DEFAULT 'direct',
  medium          TEXT NOT NULL DEFAULT '',
  orders          INTEGER NOT NULL DEFAULT 0,
  revenue         NUMERIC NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT uq_shopify_daily_attribution UNIQUE (client_id, date, source, medium)
);

CREATE INDEX idx_shopify_daily_attribution_client_date ON shopify_daily_attribution(client_id, date);

-- 4. RLS
ALTER TABLE shopify_daily_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_daily_attribution ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on shopify_daily_orders"
  ON shopify_daily_orders FOR ALL TO service_role USING (true);

CREATE POLICY "Service role full access on shopify_daily_attribution"
  ON shopify_daily_attribution FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated read on shopify_daily_orders"
  ON shopify_daily_orders FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated read on shopify_daily_attribution"
  ON shopify_daily_attribution FOR SELECT TO authenticated USING (true);
