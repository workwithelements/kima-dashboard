# GA4 Integration — Build Plan

Bring Google Analytics 4 (GA4) channel-level traffic and conversion data into the
dashboard, so we have an **independent attribution signal** alongside Shopify UTM
attribution and the weekly attribution model — plus top-of-funnel metrics
(sessions, engagement, landing pages) that no current source provides.

## Decisions locked in

- **Data-sourcing pattern:** Sync-to-Supabase daily rows (mirrors the Shopify /
  Meta / Google Ads pattern). Chosen because GA4's value here is daily channel
  data that must join with spend for attribution and blended CAC.
- **Auth:** GCP **service account**, via the official `google-auth-library`.
  **One shared service account** is granted Viewer on every client's GA4
  property; its JSON key lives in a single env var. Only the **numeric GA4
  property ID is stored per-client**. This means *no per-client secrets in the
  DB* — simpler and safer than Amplitude's per-client key/secret.

## Why this shape

Two integration patterns already exist in the repo:

| Pattern | Used by | Storage |
|---|---|---|
| Sync-to-Supabase | Shopify (`scripts/sync-shopify.ts`), Meta & Google Ads (external `kima-sync` repo) | `*_daily_*` tables, read with 5-min cache |
| Live-query | Amplitude (`lib/data/fetch-amplitude-data.ts`) | none; per-client creds on `clients` |

GA4 follows **Sync-to-Supabase**. The new `ga4_daily_traffic` table sits
naturally next to `shopify_daily_attribution` (both are date × source/medium ×
revenue) and can feed the weekly attribution model
(`WeeklyPerformanceRow` in `lib/utils/types.ts`).

---

## Prerequisites (one-time, no code)

1. Create/reuse a GCP project.
2. Enable the **Google Analytics Data API** on it.
3. Create a **service account**, download its JSON key.
4. In **each** client's GA4 property → Admin → *Property Access Management*, add
   the service-account email as a **Viewer**.
5. Record each client's numeric **GA4 property ID** (Admin → Property Settings).

Store the JSON key as env var `GA4_SERVICE_ACCOUNT_JSON` (stringified JSON) in
Netlify + `.env.local`. Add the placeholder to `.env.local.example`.

---

## Work breakdown

### 1. DB migration — `supabase-ga4.sql`

Mirror `supabase-shopify.sql` conventions (RLS: service-role full access +
authenticated read; unique constraint; index on `(client_id, date)`).

```sql
-- Per-client GA4 config (only the property ID; SA key is a shared env var)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ga4_property_id TEXT;

CREATE TABLE IF NOT EXISTS ga4_daily_traffic (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  date              DATE NOT NULL,
  channel_group     TEXT NOT NULL DEFAULT '(other)',  -- sessionDefaultChannelGroup
  source            TEXT NOT NULL DEFAULT '(direct)',  -- sessionSource
  medium            TEXT NOT NULL DEFAULT '(none)',    -- sessionMedium
  sessions          INTEGER NOT NULL DEFAULT 0,
  engaged_sessions  INTEGER NOT NULL DEFAULT 0,
  users             INTEGER NOT NULL DEFAULT 0,        -- totalUsers
  new_users         INTEGER NOT NULL DEFAULT 0,
  key_events        NUMERIC NOT NULL DEFAULT 0,        -- keyEvents (GA4 "conversions")
  conversions       NUMERIC NOT NULL DEFAULT 0,        -- ecommercePurchases (or a chosen key event)
  revenue           NUMERIC NOT NULL DEFAULT 0,        -- purchaseRevenue / totalRevenue
  created_at        TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_ga4_daily_traffic UNIQUE (client_id, date, channel_group, source, medium)
);

CREATE INDEX idx_ga4_daily_traffic_client_date ON ga4_daily_traffic(client_id, date);

ALTER TABLE ga4_daily_traffic ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on ga4_daily_traffic"
  ON ga4_daily_traffic FOR ALL TO service_role USING (true);
CREATE POLICY "Authenticated read on ga4_daily_traffic"
  ON ga4_daily_traffic FOR SELECT TO authenticated USING (true);
```

**Dimension/metric notes:** GA4's `runReport` caps at 9 dimensions / 10 metrics
per call. The set above (3 dims, 7 metrics) is comfortably within limits.
`channel_group` = `sessionDefaultChannelGroup`; source/medium = `sessionSource` /
`sessionMedium`. If cardinality (rows/day) proves heavy, drop source/medium and
keep only `channel_group`.

### 2. Types — `lib/utils/types.ts`

- Add `GA4DailyTrafficRow` (matches the table columns).
- Add `GA4AggregatedMetrics` (sessions, engagedSessions, users, newUsers,
  keyEvents, conversions, revenue) for scorecards.
- Add `ga4_property_id?: string | null` to the `Client` type.
- Optionally extend `getClientPlatforms` / add a `"ga4"` marker where a client
  has GA4 configured (note: GA4 is a *measurement* source, not an ad platform —
  keep it separate from `AdPlatform` to avoid polluting spend logic).

### 3. Auth helper — `lib/data/ga4-auth.ts`

```ts
import { JWT } from "google-auth-library"   // NEW dependency

let cached: JWT | null = null
export function getGA4Client(): JWT {
  if (cached) return cached
  const raw = process.env.GA4_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error("GA4_SERVICE_ACCOUNT_JSON not set")
  const creds = JSON.parse(raw)
  cached = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  })
  return cached
}
```

`google-auth-library` handles token minting + refresh + caching. (Hand-rolling
the RS256 JWT with Node `crypto` is the dependency-free alternative if we'd
rather not add the lib — ~40 lines, documented as a fallback.)

### 4. Fetcher — `lib/data/fetch-ga4-data.ts`

Two responsibilities, matching the existing fetchers:

- **`fetchGA4Data(clientId, from, to)`** — read `ga4_daily_traffic` from Supabase
  (paginated via `fetchAllRows`, exactly like `fetch-shopify-data.ts`). This is
  what the dashboard calls.
- **`runGA4Report(propertyId, from, to)`** — call the Data API `runReport`
  endpoint (used by the sync script and the settings `/test` route). Returns a
  structured `{ ok, data } | { ok:false, error }` like the Amplitude fetcher,
  with the same status→code mapping (401 Unauthorized, 403 Forbidden, 429 Rate
  limited, etc.).

```
POST https://analyticsdata.googleapis.com/v1beta/properties/{propertyId}:runReport
Authorization: Bearer <token from getGA4Client().getAccessToken()>
body: {
  dateRanges: [{ startDate: from, endDate: to }],
  dimensions: [{name:"date"},{name:"sessionDefaultChannelGroup"},
               {name:"sessionSource"},{name:"sessionMedium"}],
  metrics: [{name:"sessions"},{name:"engagedSessions"},{name:"totalUsers"},
            {name:"newUsers"},{name:"keyEvents"},{name:"ecommercePurchases"},
            {name:"purchaseRevenue"}],
  limit: 100000
}
```

GA4 returns `date` as `YYYYMMDD`; convert to ISO on ingest.

### 5. Sync script — `scripts/sync-ga4.ts`

Clone the structure of `scripts/sync-shopify.ts`:

- CLI: `--client-id <uuid> [--from --to --property-id]`; defaults to last 7 days.
- Resolve `ga4_property_id` from the `clients` row (or `--property-id` override).
- Call `runGA4Report`, map each dimension-row → `ga4_daily_traffic` payload,
  upsert with `onConflict: "client_id,date,channel_group,source,medium"`.
- Add `"sync:ga4": "tsx scripts/sync-ga4.ts"` to `package.json` scripts.
- Backfill: run once with a wide `--from` to seed history (GA4 keeps ~14 months
  by default on standard properties).

**Scheduling:** the repo has a GitHub Actions cron
(`.github/workflows/creative-test-analysis.yml`) and an API cron route pattern
(`app/api/cron/`). Add a daily GA4 sync the same way (nightly, syncing the
trailing ~3 days per client to catch GA4's data-processing lag).

### 6. Settings — API routes + UI

Clone the Amplitude wiring 1:1:

- **`app/api/clients/[clientId]/ga4/route.ts`** — `GET` returns
  `{ enabled, property_id, has_property }`; `PUT` updates `ga4_property_id`
  (and clears it when disabled). Uses `requireAuth` + `safeError` like the
  Amplitude route.
- **`app/api/clients/[clientId]/ga4/test/route.ts`** — runs a 30-day
  `runReport` and returns `{ ok, total_sessions, days_with_data, sample_points }`
  so the operator can confirm the property ID + SA access work before relying on
  the nightly sync.
- **UI in `components/dashboard/client-settings-view.tsx`** — add a "Google
  Analytics 4" section beside the Amplitude one: property-ID input, enable
  toggle, Save, and a "Test connection" button. Reuse the existing state/save
  patterns (`amplitude*` state block is the template, lines ~98–210).

### 7. Surfacing in the dashboard

Two options (can start with A, add B later):

- **A. Channel/traffic view** — a new tab/section rendering
  `ga4_daily_traffic`: sessions & engaged-session rate over time (Recharts, like
  existing charts), a channel-group breakdown table, and top source/medium by
  sessions + revenue.
- **B. Attribution cross-check** — surface GA4 channel revenue next to
  `shopify_daily_attribution` and the weekly attribution model, as an
  independent second opinion on where conversions come from.

Gate all GA4 UI on `client.ga4_property_id` being set, so non-GA4 clients see
nothing new — same convention as `marketing_impact_enabled` / platform gating.

### 8. Dependency + env

- `npm i google-auth-library` (add to `dependencies`).
- `.env.local.example`: add `GA4_SERVICE_ACCOUNT_JSON=` with a comment.
- Netlify env: set `GA4_SERVICE_ACCOUNT_JSON`.

---

## File-by-file checklist

| # | File | New/Edit | Notes |
|---|---|---|---|
| 1 | `supabase-ga4.sql` | New | Migration; run in Supabase SQL editor |
| 2 | `lib/utils/types.ts` | Edit | `GA4DailyTrafficRow`, `GA4AggregatedMetrics`, `Client.ga4_property_id` |
| 3 | `lib/data/ga4-auth.ts` | New | Shared SA → JWT token |
| 4 | `lib/data/fetch-ga4-data.ts` | New | `fetchGA4Data` (Supabase) + `runGA4Report` (Data API) |
| 5 | `scripts/sync-ga4.ts` | New | Nightly + backfill sync |
| 6 | `app/api/clients/[clientId]/ga4/route.ts` | New | GET/PUT config |
| 7 | `app/api/clients/[clientId]/ga4/test/route.ts` | New | Connection test |
| 8 | `components/dashboard/client-settings-view.tsx` | Edit | GA4 settings section |
| 9 | Dashboard view (new component) | New | Channel/traffic surfacing |
| 10 | `package.json` | Edit | `google-auth-library` dep + `sync:ga4` script |
| 11 | `.env.local.example` | Edit | `GA4_SERVICE_ACCOUNT_JSON` |
| 12 | GitHub Actions workflow or cron route | New | Daily sync |

## Effort estimate

- Steps 1–6 (data pipeline + settings): **~1 day** — mostly mechanical clones of
  Shopify/Amplitude code. Auth helper + one-time GCP setup is the only new bit.
- Step 7 (dashboard surfacing): **~0.5–1 day**, depending on how much UI (a
  single traffic view vs. the attribution cross-check).
- **Total: ~1.5–2 days.**

## Open questions / risks

1. **"Conversions" definition** — GA4 renamed *conversions* to *key events*.
   Decide whether `conversions` should track a specific key event (e.g.
   `purchase`, or a client-specific signup event) or `ecommercePurchases`. May
   want a per-client key-event name, like `amplitude_events`.
2. **Data freshness** — GA4 has a processing lag (often 24–48h; up to 48h for
   full accuracy). Nightly sync should re-pull the trailing ~3 days.
3. **Sampling / cardinality** — very high-traffic properties may return large
   row counts with 4 dimensions. Mitigate by dropping source/medium to keep only
   channel groups if needed.
4. **Property access** — every client property must have the SA added as Viewer;
   the `/test` route surfaces a 403 clearly when it hasn't been.
5. **GA4 vs. Shopify attribution mismatch** — GA4 (last-click, session-scoped)
   and Shopify (landing-page UTM) will disagree; surface both as distinct
   signals rather than trying to reconcile them into one number.
