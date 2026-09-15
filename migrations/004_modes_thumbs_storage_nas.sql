-- Klarbild — Generation modes, thumbnails, storage management, backup mirror.
-- (04) Combining several images + free-text generation, thumbnails for the
--      library, "don't clutter up the server" (retention / deleting sources), a
--      second backup to a backup mirror.

-- Job mode: each = every template on its own (as before), compose = several images
-- + text into ONE new image, generate = pure free text without a template.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'each'
  CHECK (mode IN ('each','compose','generate'));

-- Items: several source images (compose) + a shrunk preview image.
ALTER TABLE items ADD COLUMN IF NOT EXISTS source_paths jsonb;
ALTER TABLE items ADD COLUMN IF NOT EXISTS thumb_path text;

-- Preset recipes can pre-set a mode (for default Telegram presets).
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'each'
  CHECK (mode IN ('each','compose','generate'));

-- Storage management ---------------------------------------------------------
ALTER TABLE settings ADD COLUMN IF NOT EXISTS keep_sources   bool NOT NULL DEFAULT true;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS make_thumbnails bool NOT NULL DEFAULT true;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS retention_days int;   -- NULL = unlimited

-- Second backup to a backup mirror (SFTP/FTPS, same as the delivery target) ---
ALTER TABLE settings ADD COLUMN IF NOT EXISTS mirror_enabled      bool NOT NULL DEFAULT false;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS mirror_host         text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS mirror_protocol     text CHECK (mirror_protocol IN ('ftps','sftp'));
ALTER TABLE settings ADD COLUMN IF NOT EXISTS mirror_port         int;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS mirror_user         text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS mirror_password_enc text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS mirror_base_path    text;

-- Mirror status per item (for visibility/retrying).
ALTER TABLE items ADD COLUMN IF NOT EXISTS mirror_status text NOT NULL DEFAULT 'none'
  CHECK (mirror_status IN ('none','pending','mirrored','failed'));
