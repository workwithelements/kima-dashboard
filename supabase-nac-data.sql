-- NAC (Newly Acquired Customers) data table for TouchNote UTM analysis
CREATE TABLE IF NOT EXISTS nac_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  region TEXT NOT NULL,
  channel TEXT NOT NULL,
  campaign TEXT DEFAULT '',
  first_product TEXT NOT NULL,
  nacs INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Prevent duplicate rows for the same date/region/channel/campaign/product combo
  UNIQUE(client_id, date, region, channel, campaign, first_product)
);

-- Index for fast lookups by client and date range
CREATE INDEX IF NOT EXISTS idx_nac_data_client_date ON nac_data(client_id, date);

-- Enable RLS
ALTER TABLE nac_data ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access (matches existing dashboard pattern)
CREATE POLICY "Allow authenticated access to nac_data"
  ON nac_data FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
