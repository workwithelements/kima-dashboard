-- Per-client named funnel views (e.g. "Ecomm", "App") that each define their
-- own funnel steps, key action, and optional linked Meta campaigns. Replaces
-- the single funnel_steps / key_action pair on client_scorecard_config for
-- clients that need to separate incompatible conversion goals.
CREATE TABLE IF NOT EXISTS client_funnel_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  funnel_steps text[] NOT NULL DEFAULT '{}',
  key_action text,
  linked_campaign_ids text[] NOT NULL DEFAULT '{}',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_funnel_views_client_idx
  ON client_funnel_views (client_id, sort_order);

-- At most one default per client.
CREATE UNIQUE INDEX IF NOT EXISTS client_funnel_views_one_default_per_client
  ON client_funnel_views (client_id)
  WHERE is_default;
