-- Configurable default delivery target folder (instead of hardcoded).
ALTER TABLE settings ADD COLUMN IF NOT EXISTS delivery_default_folder text;
