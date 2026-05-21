# Pulling Meta Ads data and syncing it to Postgres

A practical guide to getting campaign, ad set, ad, and creative data out of
the Meta Marketing API and into a Postgres database you can query for
dashboards. Focuses on the parts that are easy to get wrong: auth, the
insights endpoint, breakdowns, async jobs, attribution restatement, and
schema design.

All examples target `graph.facebook.com/v21.0`. Pin a version — Meta
deprecates versions on a ~12-month cycle.

---

## 1. Auth

You need a **long-lived access token** that has access to the ad accounts
you want to read.

### Token types, ranked

1. **System User token (Business Manager)** — recommended for any
   server-to-server sync. Issued from Business Manager → System Users.
   Can be set to *never expire*. Tied to your business, not a human, so
   it survives people leaving the company.
2. **Long-lived user token** — a user token exchanged via
   `GET /oauth/access_token?grant_type=fb_exchange_token` for one that
   lasts ~60 days. Fine for prototyping; do not run production syncs on
   this.
3. **Short-lived user token** — what the OAuth login flow gives you.
   Exchange it immediately; don't store it.

### Scopes you'll actually want

- `ads_read` — minimum for reading insights, campaigns, ads, creatives.
- `ads_management` — needed if you want the direct `source` URL on
  `AdVideo` objects (the mp4). Read-only flows still work with just
  `ads_read`; you just won't get inline video URLs.
- `pages_read_engagement` — needed to read the page name/avatar and the
  underlying organic post for an ad creative (`effective_object_story_id`).
- `business_management` — needed if you want to enumerate ad accounts
  inside a Business Manager rather than hard-coding account IDs.

### Granting account access

A token only sees ad accounts the system user (or person) has been
granted access to in Business Manager. Granting "Analyst" role is enough
for read-only sync.

### Using the token

Pass it as `?access_token=<TOKEN>` or as `Authorization: Bearer <TOKEN>`.
Both work. Keep tokens server-side — never ship them to a browser.

---

## 2. The Marketing API at a glance

Base URL: `https://graph.facebook.com/v21.0`

The endpoints you'll spend 95% of your time on:

| Endpoint                                     | What it returns                                                |
| -------------------------------------------- | -------------------------------------------------------------- |
| `GET /act_{ad_account_id}/insights`          | Performance metrics. The whole dashboard.                       |
| `GET /act_{ad_account_id}/campaigns`         | Campaign list with status, objective, budgets.                  |
| `GET /act_{ad_account_id}/adsets`            | Ad set list with targeting, schedule.                           |
| `GET /act_{ad_account_id}/ads`               | Ad list with creative reference.                                |
| `GET /act_{ad_account_id}/adcreatives`       | Creative metadata (body, title, image, video, link, CTA).      |
| `GET /{creative_id}`                         | Single creative — better for paused ads.                       |
| `GET /act_{ad_account_id}/adimages`          | Resolve `image_hash` → full image URL.                          |
| `GET /act_{ad_account_id}/advideos`          | Video metadata (source URL, thumbnail).                         |

Account IDs are prefixed with `act_` for nested endpoints (`/act_123/insights`),
but **not** when used as a field value.

---

## 3. Insights — the endpoint that fills the dashboard

### Synchronous call

```
GET /act_{ad_account_id}/insights
  ?level=ad
  &fields=spend,impressions,reach,clicks,actions,action_values,
          video_p25_watched_actions,video_p50_watched_actions,
          video_p75_watched_actions,video_p95_watched_actions,
          video_p100_watched_actions,video_30_sec_watched_actions,
          campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name
  &time_range={"since":"2024-01-01","until":"2024-01-31"}
  &time_increment=1
  &limit=500
  &access_token=...
```

Key params:

- **`level`** — `account`, `campaign`, `adset`, or `ad`. Determines
  granularity. For a dashboard that drills from campaign → adset → ad,
  the cleanest design is to sync at `ad` level once per day and
  aggregate up in Postgres.
- **`time_range`** vs **`date_preset`** — prefer `time_range` (explicit
  ISO dates) so syncs are deterministic.
- **`time_increment=1`** — one row per day. Without this, you get a
  single aggregated row per entity.
- **`fields`** — comma-separated. Anything you don't list, you don't get.
- **`breakdowns`** — see §4.
- **`limit`** — max 500 typically; lower for heavy field lists.

### Pagination

Responses come with `paging.cursors.after` and `paging.next`. Either
follow `paging.next` until it disappears, or pass `after=<cursor>` on
the next call.

### Actions are nested — flatten them

`actions` and `action_values` come back as arrays:

```json
"actions": [
  {"action_type": "landing_page_view", "value": "42"},
  {"action_type": "offsite_conversion.fb_pixel_purchase", "value": "3"},
  {"action_type": "offsite_conversion.fb_pixel_add_to_cart", "value": "11"}
]
```

You almost always want to flatten these into named columns
(`landing_page_views`, `purchases`, `adds_to_cart`, …). Common action
types to map:

| Action type                                            | Conventional column name        |
| ------------------------------------------------------ | ------------------------------- |
| `link_click`                                           | `link_clicks`                   |
| `landing_page_view`                                    | `landing_page_views`            |
| `offsite_conversion.fb_pixel_add_to_cart`              | `adds_to_cart`                  |
| `offsite_conversion.fb_pixel_initiate_checkout`        | `checkouts_initiated`           |
| `offsite_conversion.fb_pixel_purchase`                 | `purchases`                     |
| `offsite_conversion.fb_pixel_complete_registration`    | `registrations_completed`       |
| `start_trial_total` / `offsite_conversion.fb_pixel_start_trial` | `trials_started`        |
| `mobile_app_install`                                   | `app_installs`                  |
| `app_custom_event.fb_mobile_complete_registration`     | `mobile_app_registrations`      |

For `action_values` (revenue), the same flattening but summing the
`value`. Use `action_attribution_windows` to control the window —
Meta's default is `7d_click,1d_view` since iOS 14.

### Video metrics

Video quartile metrics are also arrays (`video_p25_watched_actions`,
etc.) keyed on `action_type=video_view`. Take `.value` from the first
entry.

### Estimated ad recall

`estimated_ad_recallers` (paired with `reach`) lets you compute "recall
lift rate" the same way Ads Manager does. Available only for objectives
that support brand-lift measurement.

### Async insights — when you must

If your `time_range` or breakdown combo would return too many rows,
Meta will reject the synchronous call (error #1 or #100, "Please
reduce the amount of data"). Use the async pattern:

```
1. POST /act_{ad_account_id}/insights  (same params)
   → returns { report_run_id }
2. Poll GET /{report_run_id}
   → async_status: "Job Not Started" → "Job Started" → "Job Running"
                  → "Job Completed" (or "Job Failed")
3. GET /{report_run_id}/insights?limit=500
   → paginated rows, same shape as the sync endpoint
```

Backfills of more than ~30 days at ad-level with breakdowns essentially
require this path.

---

## 4. Breakdowns

Add `breakdowns=...` to split metrics by a dimension. The big three:

| Breakdown set                                                   | What it gives you                                   |
| --------------------------------------------------------------- | --------------------------------------------------- |
| `age,gender`                                                    | Demographics table.                                  |
| `publisher_platform,platform_position,impression_device`        | Placements table (FB/IG feed/reels/stories, etc.). |
| `country` or `region`                                           | Geo breakdown.                                       |

Caveats:

- **Breakdowns can't always be combined with all metrics.** Meta has a
  compatibility matrix; some action types disappear when you add a
  breakdown. Test the exact field+breakdown combo you intend to ship.
- **Breakdown rows multiply.** A single ad on a single day with
  `age,gender` returns up to ~14 rows. Plan your row counts and storage
  accordingly.
- **Each breakdown is a separate sync.** You can't fetch
  `age,gender` and `publisher_platform` in one call and split them
  apart later — they're independent queries against separate
  pre-aggregated tables on Meta's side.

---

## 5. Creative data

For each ad, `creative.id` is the stable handle. Fetch creative details
with a single richly-expanded call:

```
GET /{creative_id}
  ?fields=id,body,title,call_to_action_type,link_url,image_url,
          thumbnail_url,video_id,effective_object_story_id,
          object_story_spec{
            page_id,
            link_data{message,name,description,link,caption,call_to_action,
                      image_hash,picture,video_id,
                      child_attachments{name,description,link,picture,
                                        image_hash,call_to_action,video_id}},
            video_data{title,message,call_to_action,image_hash,image_url,
                       video_id,link_description},
            photo_data{url,caption}
          },
          asset_feed_spec{
            bodies{text},titles{text},descriptions{text},
            link_urls{website_url,display_url},
            images{hash,url},
            videos{video_id,thumbnail_hash,thumbnail_url},
            call_to_action_types
          }
```

Why both `object_story_spec` and `asset_feed_spec`:

- **Classic creatives** (static link/image/video/carousel ads) live in
  `object_story_spec`.
- **Advantage+ Shopping and dynamic creatives** put their media + copy
  inside `asset_feed_spec` as parallel arrays of variants. If you only
  read `object_story_spec`, dynamic creatives come back empty.

### Image hashes

Meta often returns an `image_hash` instead of a URL. Resolve in a single
batched call:

```
GET /act_{ad_account_id}/adimages?hashes=["h1","h2","h3"]&fields=hash,url
```

This is the **only reliable path** for some Advantage+ creatives — the
hash → URL lookup works regardless of page permissions.

### Video URLs

`AdVideo.source` (the direct mp4) requires `ads_management`. With only
`ads_read`, you'll get a `(#100)` error per video. Fallback chain that
works in practice:

1. `GET /?ids=v1,v2&fields=source` — needs `ads_management`.
2. `GET /{effective_object_story_id}?fields=source,attachments{media{source}}`
   — the underlying post's video source. Sometimes succeeds when (1)
   doesn't.
3. `GET /{ad_id}/previews?ad_format=MOBILE_FEED_STANDARD` — returns an
   iframe wrapper. Server-side fetch that iframe and regex out
   `"videoURIHD":"…"` / `"videoURISD":"…"`. Last resort. URLs expire
   in ~1-2 hours.
4. Embed Facebook's video plugin
   (`facebook.com/plugins/video.php?href=…`) — needs no token, plays
   inline in an iframe.

### Thumbnail URL expiry

Meta's CDN URLs expire after ~24 hours. Don't store thumbnail URLs and
serve them long-term. Either:

- **Re-fetch on demand** — store `creative_id`, hit
  `GET /{creative_id}?fields=image_url,thumbnail_url` when a request
  comes in, cache for an hour.
- **Proxy + restream** — fetch via your server with a fresh URL each
  time, send the bytes to the browser. Solves CSP/referrer issues at
  the same time.

---

## 6. Rate limits

Meta throttles per-app and per-ad-account using **Business Use Case**
(BUC) limits. Every response includes a usage header:

```
X-Business-Use-Case-Usage: {"<ad_account_id>":[{"type":"ads_insights",
  "call_count":42,"total_cputime":17,"total_time":31,
  "estimated_time_to_regain_access":0}]}
```

Treat each of `call_count`, `total_cputime`, `total_time` as a
percentage (0-100). Back off when any hits ~80. Hitting 100 returns
error code `#17` (User request limit reached) or `#80004`, and
`estimated_time_to_regain_access` (minutes) tells you how long.

Other errors worth handling explicitly:

| Code            | Meaning                              | What to do                              |
| --------------- | ------------------------------------ | --------------------------------------- |
| `#1`            | Unknown / rows too large             | Switch to async insights.               |
| `#4` / `#17`    | Rate limit                           | Back off; respect retry header.         |
| `#100`          | Bad param (field name, combo)       | Don't retry. Fix the query.             |
| `#190`          | Token expired/invalid                | Re-mint token; alert.                   |
| `#200` / `#10`  | Permission                           | Check scopes and account access.        |
| `#80004`        | BUC throttling                       | Slow down.                              |

---

## 7. Postgres schema

A schema that mirrors how Meta returns data — one table per breakdown
shape — keeps queries simple. Suggested tables:

```sql
CREATE TABLE meta_daily_performance (
  client_id          UUID    NOT NULL,
  date               DATE    NOT NULL,
  campaign_id        TEXT,
  campaign_name      TEXT,
  adset_id           TEXT,
  adset_name         TEXT,
  ad_id              TEXT,
  ad_name            TEXT,
  spend              NUMERIC NOT NULL DEFAULT 0,
  impressions        BIGINT  NOT NULL DEFAULT 0,
  reach              BIGINT  NOT NULL DEFAULT 0,
  unique_link_clicks BIGINT  NOT NULL DEFAULT 0,
  landing_page_views BIGINT  NOT NULL DEFAULT 0,
  adds_to_cart       BIGINT  NOT NULL DEFAULT 0,
  checkouts_initiated BIGINT NOT NULL DEFAULT 0,
  purchases          BIGINT  NOT NULL DEFAULT 0,
  purchase_value     NUMERIC NOT NULL DEFAULT 0,
  -- ... more action columns as needed
  video_plays        BIGINT  NOT NULL DEFAULT 0,
  video_3s_views     BIGINT  NOT NULL DEFAULT 0,
  video_p25          BIGINT  NOT NULL DEFAULT 0,
  video_p50          BIGINT  NOT NULL DEFAULT 0,
  video_p75          BIGINT  NOT NULL DEFAULT 0,
  video_p95          BIGINT  NOT NULL DEFAULT 0,
  video_p100         BIGINT  NOT NULL DEFAULT 0,
  estimated_ad_recallers INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, date, ad_id)
);

CREATE INDEX idx_meta_daily_perf_client_date
  ON meta_daily_performance (client_id, date);
CREATE INDEX idx_meta_daily_perf_client_campaign
  ON meta_daily_performance (client_id, campaign_id);
CREATE INDEX idx_meta_daily_perf_client_adset
  ON meta_daily_performance (client_id, adset_id);

CREATE TABLE meta_daily_demographics (
  client_id     UUID    NOT NULL,
  date          DATE    NOT NULL,
  ad_id         TEXT    NOT NULL,
  age           TEXT    NOT NULL,
  gender        TEXT    NOT NULL,
  spend         NUMERIC NOT NULL DEFAULT 0,
  impressions   BIGINT  NOT NULL DEFAULT 0,
  reach         BIGINT  NOT NULL DEFAULT 0,
  purchases     BIGINT  NOT NULL DEFAULT 0,
  purchase_value NUMERIC NOT NULL DEFAULT 0,
  -- ... other metrics
  PRIMARY KEY (client_id, date, ad_id, age, gender)
);

CREATE TABLE meta_daily_placements (
  client_id          UUID    NOT NULL,
  date               DATE    NOT NULL,
  ad_id              TEXT    NOT NULL,
  publisher_platform TEXT    NOT NULL,
  platform_position  TEXT    NOT NULL,
  impression_device  TEXT    NOT NULL,
  spend              NUMERIC NOT NULL DEFAULT 0,
  impressions        BIGINT  NOT NULL DEFAULT 0,
  reach              BIGINT  NOT NULL DEFAULT 0,
  purchases          BIGINT  NOT NULL DEFAULT 0,
  purchase_value     NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, date, ad_id,
               publisher_platform, platform_position, impression_device)
);

CREATE TABLE meta_ad_metadata (
  client_id              UUID NOT NULL,
  ad_id                  TEXT PRIMARY KEY,
  creative_id            TEXT,
  created_time           TIMESTAMPTZ,
  creative_thumbnail_url TEXT,
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_meta_ad_metadata_client_created
  ON meta_ad_metadata (client_id, created_time);
```

### Design notes

- **Composite primary keys** including `client_id` + `date` + the
  breakdown dimensions make UPSERT idempotent. Re-running the sync for
  the same day overwrites rather than duplicates.
- **Index `(client_id, date)`** for the universal dashboard query:
  *give me all rows for this client between these dates*.
- **Store IDs as `TEXT`**, not `BIGINT`. Meta IDs are technically
  numeric but routinely exceed 2^53 (JS `Number.MAX_SAFE_INTEGER`),
  and Meta sometimes prefixes them. Strings are safer.
- **Don't normalize too eagerly.** Carrying `campaign_name`,
  `adset_name`, `ad_name` redundantly on the daily row makes the
  dashboard query a single table scan with no joins. Names change
  occasionally; take the most-recent name as canonical.

### Idempotent UPSERT

```sql
INSERT INTO meta_daily_performance (
  client_id, date, ad_id, campaign_id, campaign_name, ..., spend, impressions, ...
) VALUES (...)
ON CONFLICT (client_id, date, ad_id) DO UPDATE SET
  campaign_name = EXCLUDED.campaign_name,
  adset_name    = EXCLUDED.adset_name,
  ad_name       = EXCLUDED.ad_name,
  spend         = EXCLUDED.spend,
  impressions   = EXCLUDED.impressions,
  -- ... every metric
  ;
```

---

## 8. Sync strategy

### Initial backfill

- One async insights job per ad account, ad-level, daily breakdown,
  for the full history you want (e.g. last 18 months).
- Poll until `Job Completed`, paginate all rows.
- UPSERT in batches of 500-1000 to Postgres.

### Incremental nightly sync

Schedule a cron that runs daily. Each run:

1. Compute the date range to refresh. **Do not refresh only yesterday.**
   Meta restates attributed conversions for up to **28 days** as
   `7d_click,1d_view` windows mature. Refresh the **last 28-30 days**
   on every run. Disk is cheap; under-counting purchases isn't.
2. Pull insights for that window (async for safety).
3. UPSERT into `meta_daily_performance`, `meta_daily_demographics`,
   `meta_daily_placements`.
4. Refresh `meta_ad_metadata` for any ad IDs you saw — pull
   `created_time`, `creative_id`, `creative.thumbnail_url`.

### Intra-day refresh (optional)

If your dashboard needs near-real-time *today's spend*, run a lighter
job every hour that refreshes only today's row at campaign level.
Today's data lags ~10-15 minutes regardless.

### Currency

Insights returns spend in the **ad account's currency**, not a single
canonical one. Store `currency_code` alongside `client_id` (read it
once from `GET /act_{ad_account_id}?fields=currency`) and convert at
display time, not at sync time.

---

## 9. Reading from Postgres

The point of all this is that your dashboard query becomes a plain SQL
aggregate, with no API in the hot path:

```sql
SELECT
  campaign_name,
  SUM(spend)         AS spend,
  SUM(impressions)   AS impressions,
  SUM(purchases)     AS purchases,
  SUM(purchase_value) AS revenue,
  CASE WHEN SUM(spend) > 0 THEN SUM(purchase_value) / SUM(spend) END AS roas
FROM meta_daily_performance
WHERE client_id = $1
  AND date BETWEEN $2 AND $3
GROUP BY campaign_name
ORDER BY spend DESC;
```

Returns in milliseconds with the composite index in §7. The API budget
gets spent on the nightly sync only.

---

## 10. fbclid and attribution

`fbclid` is the click identifier Meta appends to landing-page URLs
(`?fbclid=...`). It is **not queryable**: there is no Marketing API
endpoint that takes an `fbclid` and tells you the campaign/adset/ad it
came from.

To get ad-level attribution on your side:

- **At click time** — configure ad URL parameters with Meta's macros:
  `?utm_source=facebook&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}`.
  Meta substitutes real IDs into the URL; your landing page reads them
  as ordinary query params.
- **At conversion time** — send `fbclid` (and `_fbp`, `_fbc` cookies)
  to the **Conversions API** at `POST /{pixel_id}/events`. Meta does
  the matching server-side; the conversion shows up against the
  correct ad in the insights endpoint described above.

You don't need to query `fbclid` if you've set up URL parameters
correctly — you already have the IDs on your own side.

---

## Quick checklist

- [ ] Business Manager set up with a System User
- [ ] System User token minted with `ads_read` (plus `ads_management` /
      `pages_read_engagement` if you need creative media)
- [ ] System User granted Analyst access to each ad account
- [ ] Postgres tables created with composite PKs and `(client_id, date)`
      indexes
- [ ] Async insights backfill complete
- [ ] Nightly cron refreshing the **last 28 days** with UPSERT
- [ ] Ad metadata table populated with `creative_id` for thumbnail
      refresh
- [ ] Rate limit header monitoring in place
- [ ] Token expiry monitored (System User tokens can expire if mismanaged)
- [ ] Ad URL parameter macros configured if you need landing-page-level
      attribution
