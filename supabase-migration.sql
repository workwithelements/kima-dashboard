-- Add slug and view_password_hash to clients table for client-facing dashboards
ALTER TABLE clients ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS view_password_hash TEXT;

-- Set initial slugs from client names (lowercase, hyphenated)
UPDATE clients SET slug = LOWER(REPLACE(REPLACE(name, ' ', '-'), '&', 'and'))
WHERE slug IS NULL;
