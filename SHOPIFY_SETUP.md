# Shopify Data Integration Setup

## Prerequisites

- A Shopify store with a **custom app** that has `read_orders` access scope
- The Supabase migration applied (see Step 1)
- Node.js 18+ installed

## Step 1: Run the database migrations

In the **Supabase SQL Editor**, run **both** migration files in order:

1. `supabase-shopify.sql` — base tables + `clients.shopify_store_domain`
2. `supabase-shopify-cogs-rate.sql` — adds `clients.shopify_cogs_rate` (per-client default COGS used by the sync + the daily cron)

The contents of `supabase-shopify.sql`:

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

## Step 4: Enable Shopify on the client (in the dashboard)

In the admin dashboard, open the client's **Settings** tab and:

1. Toggle **Enable Shopify data** on
2. Enter the **Store domain** (e.g. `lucky-beau.myshopify.com`)
3. Enter the **COGS rate** as a percent (e.g. `35` for 35% of gross revenue)
4. Click **Save**

These values are stored on the client row (`shopify_store_domain`, `shopify_cogs_rate`), and the daily cron picks them up automatically.

## Step 5: Run an initial backfill

In your **terminal** (not the SQL editor):

```bash
# Install dependencies (first time only)
npm install

# Sync last 7 days using the client's stored store_domain + cogs_rate
npm run sync:shopify -- --client-id <uuid>

# Backfill a custom date range
npm run sync:shopify -- --client-id <uuid> --from 2024-01-01 --to 2024-03-31

# Override the stored COGS rate for this run only
npm run sync:shopify -- --client-id <uuid> --cogs-rate 0.40
```

## Step 6: Recurring sync via cron route

The dashboard exposes `POST /api/cron/shopify-sync` which syncs **every active client with a Shopify store domain**. Wire your scheduler (Netlify Scheduled Functions, Vercel Cron, GitHub Actions, etc.) to call it daily, e.g. 6am:

```bash
curl -X POST https://<dashboard-host>/api/cron/shopify-sync \
  -H "Authorization: Bearer $CRON_SECRET"
```

Query params:

- `?days=3` — how many days back to sync (default 3, rolling window catches late refunds)
- `?client_id=<uuid>` — restrict to a single client (useful for ad-hoc triggers)

The route uses `SHOPIFY_ACCESS_TOKEN` for all stores by default. To use a different token per store, set `SHOPIFY_ACCESS_TOKEN_<STORENAME>` (uppercase, non-alphanumerics replaced with `_`) — e.g. `SHOPIFY_ACCESS_TOKEN_LUCKY_BEAU` for `lucky-beau.myshopify.com`.

## What the dashboard shows

Once data is synced, the client's Performance tab will display:

- **Shopify Store** -- Orders, Net Revenue (after discounts & refunds), AOV
- **Meta vs Shopify Attribution** -- Revenue/order gaps between Meta-reported and Shopify UTM data
- **Contribution Margin 3** -- Gross Profit, CM3, CM3 ROAS (using real COGS/shipping from Shopify)
- **Meta Incremental Revenue** -- Blended ROAS, Meta Blended ROAS, Meta Revenue Share
