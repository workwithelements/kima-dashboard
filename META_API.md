# How the dashboard uses the Meta API

There are two distinct paths for getting Meta data onto the dashboard:

1. **Bulk performance data** — synced into Supabase by an **external job**, then read out of Postgres at request time. This is what fills almost every chart, scorecard, and table.
2. **Live Graph API calls** — made by this app at request time for two surfaces only: ad creative previews and the thumbnail image proxy.

Everything in `lib/data/fetch-*-data.ts` reads from Supabase, **not** from Meta. If you came here looking for the code that pulls insights from `graph.facebook.com` into a table, that code is not in this repo.

---

## 1. Bulk performance — Supabase, not live

### Tables

The dashboard reads from these tables (all keyed on `client_id` + `date`):

| Table                          | What it holds                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `meta_daily_performance`       | One row per (client, date, campaign, adset, ad) with spend, impressions, reach, clicks, LPVs, ATC, purchases, video quartiles, etc. |
| `meta_daily_demographics`      | Same metrics broken out by `age` and `gender`.                                                                                       |
| `meta_daily_placements`        | Same metrics broken out by `publisher_platform`, `platform_position`, `impression_device`.                                           |
| `meta_ad_metadata`             | `ad_id` → `creative_id`, `created_time`, `creative_thumbnail_url`. Used for thumbnails and the "new ad" test badge.                  |
| `meta_ad_creative_previews`    | JSON cache of normalized creative data, keyed by `(ad_id, format)`. Written by the ad-preview route (see §2).                        |

Column list for `meta_daily_performance` is defined as `PERF_COLUMNS` in `lib/data/fetch-client-data.ts:36`:

```
date, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
spend, impressions, reach, unique_link_clicks, landing_page_views,
adds_to_cart, registrations_completed, trials_started, checkouts_initiated,
purchases, purchase_value, app_installs, mobile_app_registrations,
estimated_ad_recallers, video_plays, video_3s_views,
video_p25, video_p50, video_p75, video_p95, video_p100
```

The TypeScript shape mirroring these columns is `MetaDailyRow` in `lib/utils/types.ts:6`.

### How the sync gets here (out of scope of this repo)

Schema-only artifacts live in this repo as Supabase migration SQL files:

- `supabase-performance-indexes.sql` — composite indexes on `(client_id, date)` for the four meta tables.
- `supabase-ad-recall.sql` — adds `estimated_ad_recallers`.
- `supabase-trials-started.sql` — adds `trials_started`.
- `supabase-creative-id-migration.sql` — adds `creative_id` to `meta_ad_metadata`.
- `supabase-ad-previews.sql` — creates the `meta_ad_creative_previews` cache table.

Each migration file notes the same thing: "The Meta sync job that populates `meta_daily_performance` must be updated separately." The sync job itself is **not** in this repo. It runs elsewhere, hits the Marketing API insights endpoint, and upserts into the tables above. To extend the data model:

1. Add the column with a `supabase-*.sql` migration.
2. Update the external sync to read the new field from the Marketing API and write into the column.
3. Add the column to `PERF_COLUMNS` (or the relevant `DEMO_COLUMNS` / `PLACEMENT_COLUMNS`) and to `MetaDailyRow`.
4. Consume it in the dashboard.

### Read path

Entry points, all server-side, all wrapped in `unstable_cache` with a **5-minute TTL** (`CACHE_TTL_SECONDS` in `lib/data/fetch-client-data.ts:12`):

| Function                  | Used by                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `fetchClientData`         | The main client performance page — `meta_daily_performance` for primary + comparison ranges, lifetime totals, baseline reach, recent ad metadata, naming config. |
| `fetchClientsList`        | Admin clients index — aggregates spend across Meta + Google + Shopify per client.    |
| `fetchReachData`          | Reach analysis page.                                                                  |
| `fetchCreativeData`       | Creative grid + creative detail modal. Also pulls demographics and placements.        |
| `fetchBreakdownsData`     | Demographics/placements breakdown page.                                               |
| `fetchAdVolumeData`       | The ad-volume calculator card.                                                        |
| `fetchConsolidatedSpend`  | Pacing pages — sums Meta + Google Ads spend per day.                                  |

All large queries route through `fetchAllRows()` (`lib/data/fetch-client-data.ts:18`), which paginates around PostgREST's hard 1000-row cap by issuing `.range(offset, offset+pageSize-1)` until a short page comes back.

Caches are tagged `client:${clientId}` so revalidation can be scoped per client (`revalidateTag`).

### Client → Meta account linkage

The `clients` table has a `meta_account_id` column. `lib/utils/types.ts:202` uses its presence to determine whether to show the Meta platform tab:

```ts
if (client.meta_account_id) platforms.push("meta")
```

The admin "Add client" modal (`components/dashboard/add-client-modal.tsx:51`) and `app/api/clients/route.ts:13` write this field. The dashboard never authenticates as the client to Meta — it just stores the account ID for display and for the external sync job to key on.

---

## 2. Live Graph API — only for previews and thumbnails

Two routes hit `graph.facebook.com` directly. Both use the same module-level constant:

```ts
const META_GRAPH_URL = "https://graph.facebook.com/v21.0"
```

Both read a single shared token from `process.env.META_ACCESS_TOKEN`. There is **no OAuth flow, no token refresh, no per-client token storage** in this codebase — it's one long-lived server-side token. The token never leaves the server; clients hit our routes, not Meta.

### 2.1 `GET /api/ad-preview?ad_id=<ad_id>`

Source: `app/api/ad-preview/route.ts`.

Returns structured creative data (`AdCreativeData`, defined at line 32) that the frontend renders with a custom card component — we deliberately do **not** use Meta's iframe preview, which never rendered properly inside our sandboxed `srcDoc`.

Flow:

1. **Cache check** — `meta_ad_creative_previews` keyed by `(ad_id, "v11")`. If `fetched_at` is < 24h old (`CACHE_TTL_MS`), return it.
2. **Resolve creative** — look up `creative_id` from `meta_ad_metadata`. Try `GET /{creative_id}?fields=...` first (works for paused ads); fall back to `GET /{ad_id}?fields=creative{...}`.
3. **Field bundle** — see `CREATIVE_FIELDS` at line 9. Pulls `body`, `title`, `image_url`, `thumbnail_url`, `video_id`, `effective_object_story_id`, plus a nested `object_story_spec{...}` and `asset_feed_spec{...}` expansion to cover both classic and Advantage+ Shopping creatives in one round-trip.
4. **Enrichment** — once we have the creative, fire **five parallel** follow-up calls (line 194):
   - `GET /{page_id}?fields=name,picture.type(large)` — page name + avatar (`fetchPageInfo`, line 298).
   - `GET /?ids=v1,v2,...&fields=source,picture` — batched video source URLs (`fetchVideoSources`, line 485). Usually 400s without `ads_management`; we tolerate it.
   - `GET /{effective_object_story_id}?fields=full_picture,source,permalink_url,attachments{...}` — the underlying organic post, used for full-res image and a fallback video URL (`fetchPostInfo`, line 442).
   - `GET /act_{account_id}/adimages?hashes=[...]&fields=hash,url` — resolves `image_hash` values to full URLs (`fetchImagesByHash`, line 325). Often the only path that works.
   - `GET /{resource_id}/previews?ad_format=MOBILE_FEED_STANDARD` — last-resort: scrape the inner `preview_iframe.php` HTML and regex out a `videoURIHD` / `videoURISD` fbcdn URL (`extractInlineVideoUrl`, line 380).
5. **Normalize** — `normalizeCreative` (line 536) flattens the messy Meta shape into the `AdCreativeData` we return, picking the best available URL through a documented priority chain.
6. **Write back** — fire-and-forget `upsert` into `meta_ad_creative_previews` (line 213).

If `META_ACCESS_TOKEN` is unset, the route returns the stale cache if available, otherwise 503. If all Graph attempts fail, it returns 502 with an `attempts` array describing each failure.

### 2.2 `GET /api/thumbnail?ad_id=<ad_id>`

Source: `app/api/thumbnail/route.ts`.

A server-side image proxy. Solves two problems: Meta CDN URLs expire after ~24h (403), and CSP/referrer policy blocks direct browser loading of fbcdn URLs.

Flow:

1. Look up `creative_thumbnail_url` + `creative_id` from `meta_ad_metadata`.
2. Try the cached URL. If it 403s, fetch a fresh URL: `GET /{creative_id}?fields=image_url,thumbnail_url` (or `GET /{ad_id}?fields=creative{image_url,thumbnail_url}` if no creative_id).
3. Write the fresh URL back into `meta_ad_metadata.creative_thumbnail_url` (fire-and-forget).
4. Stream the image bytes back with `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`.
5. If everything fails, return a 1×1 transparent PNG so the frontend doesn't break.

---

## Environment

The only Meta env var the app needs is:

```
META_ACCESS_TOKEN   # long-lived server-side token, scopes: ads_read at minimum
```

Scope notes from the code:

- `ads_read` is enough for creative metadata and `/adimages`.
- `source` on `AdVideo` (the inline mp4 URL) needs `ads_management`; the code logs and tolerates the 400 when that's missing and falls back to the `/previews` HTML scrape.
- The page-info call needs `pages_read_engagement` on the linked page; without it, the page name/avatar come back null and the preview renders without header chrome.

Supabase env vars (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) are required for every read path above — the service-role client is created in `lib/supabase/server.ts` via `createServiceClient()`.

---

## Quick map

```
Browser ──► /api/ad-preview ──► graph.facebook.com/v21.0/...   (live, cached 24h in meta_ad_creative_previews)
Browser ──► /api/thumbnail  ──► fbcdn URL (then graph.facebook.com on expiry)
Browser ──► /dashboard/...  ──► lib/data/fetch-*-data.ts ──► Supabase tables (cached 5m via unstable_cache)
                                                                  ▲
                                                                  │
                                            External sync job (NOT in this repo)
                                            hits Marketing API insights and
                                            upserts into meta_daily_performance,
                                            meta_daily_demographics,
                                            meta_daily_placements,
                                            meta_ad_metadata.
```
