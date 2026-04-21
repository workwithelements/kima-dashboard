-- Organic Social tracking for Ezra (and any future client that opts in).
-- Three tables: scraped Instagram tagged posts (+ optional snapshot history),
-- weekly bookings (CSV-imported), and weekly HDYHAU allocations (CSV-imported).

-- ─── instagram_tagged_posts ──────────────────────────────────────────────
-- Snapshot-latest row per post. `last_scraped_at` reflects the most recent
-- Apify run; like/comment counts in this table are the latest snapshot.
CREATE TABLE IF NOT EXISTS instagram_tagged_posts (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  post_url           TEXT        NOT NULL,
  shortcode          TEXT        NOT NULL,
  post_type          TEXT,                 -- "image" | "video" | "sidecar" | "reel"
  taken_at           TIMESTAMPTZ NOT NULL,
  week_start_date    DATE        NOT NULL, -- ISO-week Monday of taken_at
  author_username    TEXT        NOT NULL,
  author_full_name   TEXT,
  author_followers   INTEGER,              -- snapshot at scrape time
  author_is_verified BOOLEAN,
  caption            TEXT,
  thumbnail_url      TEXT,
  like_count         INTEGER     DEFAULT 0,
  comment_count      INTEGER     DEFAULT 0,
  video_view_count   INTEGER,
  play_count         INTEGER,
  hashtags           TEXT[]      DEFAULT '{}',
  mentions           TEXT[]      DEFAULT '{}',
  apify_run_id       TEXT,
  raw                JSONB,
  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_scraped_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, post_url)
);

CREATE INDEX IF NOT EXISTS idx_ig_tagged_client_week
  ON instagram_tagged_posts (client_id, week_start_date);
CREATE INDEX IF NOT EXISTS idx_ig_tagged_client_taken_at
  ON instagram_tagged_posts (client_id, taken_at);
CREATE INDEX IF NOT EXISTS idx_ig_tagged_client_author
  ON instagram_tagged_posts (client_id, author_username);

-- ─── instagram_post_snapshots ────────────────────────────────────────────
-- Append-only engagement history. Enables "48h engagement velocity" later
-- without reshaping v1 data.
CREATE TABLE IF NOT EXISTS instagram_post_snapshots (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  post_url         TEXT        NOT NULL,
  scraped_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  like_count       INTEGER,
  comment_count    INTEGER,
  video_view_count INTEGER,
  play_count       INTEGER,

  UNIQUE (client_id, post_url, scraped_at)
);

CREATE INDEX IF NOT EXISTS idx_ig_snapshot_client_url
  ON instagram_post_snapshots (client_id, post_url, scraped_at DESC);

-- ─── weekly_bookings ─────────────────────────────────────────────────────
-- Manually-imported weekly booking totals (all channels combined).
CREATE TABLE IF NOT EXISTS weekly_bookings (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  week_start_date DATE        NOT NULL,
  bookings        INTEGER     NOT NULL DEFAULT 0,
  revenue         NUMERIC(12,2),
  notes           TEXT,
  uploaded_by     UUID        REFERENCES auth.users(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, week_start_date)
);

CREATE INDEX IF NOT EXISTS idx_weekly_bookings_client_week
  ON weekly_bookings (client_id, week_start_date);

-- ─── weekly_hdyhau ───────────────────────────────────────────────────────
-- "How did you hear about us" weekly allocations. Long format: one row per
-- (week, channel). The API route accepts either a wide CSV (like the user's
-- screenshot) and pivots, or a long CSV.
CREATE TABLE IF NOT EXISTS weekly_hdyhau (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  week_start_date DATE        NOT NULL,
  channel         TEXT        NOT NULL,
  dollars         NUMERIC(12,2) NOT NULL DEFAULT 0,
  uploaded_by     UUID        REFERENCES auth.users(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, week_start_date, channel)
);

CREATE INDEX IF NOT EXISTS idx_weekly_hdyhau_client_week
  ON weekly_hdyhau (client_id, week_start_date);

-- ─── clients.instagram_tagged_url ────────────────────────────────────────
-- Per-client URL the Apify sync script scrapes. Nullable; only Ezra is
-- populated today.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS instagram_tagged_url TEXT;

-- ─── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE instagram_tagged_posts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_post_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_bookings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_hdyhau             ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated access to instagram_tagged_posts"
  ON instagram_tagged_posts FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated access to instagram_post_snapshots"
  ON instagram_post_snapshots FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated access to weekly_bookings"
  ON weekly_bookings FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated access to weekly_hdyhau"
  ON weekly_hdyhau FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);
