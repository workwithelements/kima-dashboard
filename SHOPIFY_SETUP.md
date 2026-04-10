# Shopify Data Integration Setup

## Prerequisites

- A Shopify store with a **custom app** that has `read_orders` access scope
- The Supabase migration applied (see Step 1)
- Node.js 18+ installed

## Step 1: Run the database migration

In the **Supabase SQL Editor**, run the contents of `supabase-shopify.sql`:

```sql
ALTER TABLE clients ADD COLUMN IF NOT EXISTS shopify_store_domain TEXT;

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

CREATE INDEX IF NOT EXISTS idx_shopify_daily_orders_client_date ON shopify_daily_orders(client_id, date);

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

CREATE INDEX IF NOT EXISTS idx_shopify_daily_attribution_client_date ON shopify_daily_attribution(client_id, date);

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
```

## Step 2: Create a Shopify custom app

1. In Shopify Admin, go to **Settings > Apps and sales channels > Develop apps**
2. Click **Create an app**, give it a name (e.g. "Kima Dashboard Sync")
3. Under **Configuration > Admin API access scopes**, select `read_orders`
4. Click **Install app**
5. Copy the **Admin API access token** (starts with `shpat_`)

## Step 3: Set environment variables

Add to your `.env.local`:

```
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_your-access-token-here
```

## Step 4: Set the client's store domain (optional)

In Supabase, update the client record:

```sql
UPDATE clients SET shopify_store_domain = 'your-store.myshopify.com' WHERE id = '<client-uuid>';
```

## Step 5: Run the sync

In your **terminal** (not the SQL editor):

```bash
# Install dependencies (first time only)
npm install

# Sync last 7 days (default)
npm run sync:shopify -- --client-id <uuid>

# Sync a custom date range
npm run sync:shopify -- --client-id <uuid> --from 2024-01-01 --to 2024-03-31

# With COGS estimate (35% of gross revenue)
npm run sync:shopify -- --client-id <uuid> --cogs-rate 0.35

# Override store/token (instead of env vars)
npm run sync:shopify -- --client-id <uuid> --store my-store.myshopify.com --token shpat_xxx
```

## Step 6: Set up recurring sync (optional)

Add a cron job to sync daily, e.g. at 6am:

```
0 6 * * * cd /path/to/kima-dashboard && npx tsx scripts/sync-shopify.ts --client-id <uuid>
```

## What the dashboard shows

Once data is synced, the client's Performance tab will display:

- **Shopify Store** -- Orders, Net Revenue (after discounts & refunds), AOV
- **Meta vs Shopify Attribution** -- Revenue/order gaps between Meta-reported and Shopify UTM data
- **Contribution Margin 3** -- Gross Profit, CM3, CM3 ROAS (using real COGS/shipping from Shopify)
- **Meta Incremental Revenue** -- Blended ROAS, Meta Blended ROAS, Meta Revenue Share
