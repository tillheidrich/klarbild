-- Backup to any target, metadata sidecar files, API token for external access (MCP).

-- Any extra target can be flagged as a backup target (receives ALL results).
ALTER TABLE delivery_targets ADD COLUMN IF NOT EXISTS is_backup bool NOT NULL DEFAULT false;

-- Send metadata along as a companion .md file (prompt, file name, model, …).
ALTER TABLE settings ADD COLUMN IF NOT EXISTS metadata_sidecar bool NOT NULL DEFAULT false;

-- API token for programmatic access (Klarbild MCP / automations).
ALTER TABLE settings ADD COLUMN IF NOT EXISTS api_token text;

-- Backup status per target and item (for "backed up to several targets").
CREATE TABLE IF NOT EXISTS item_backups (
  item_id   uuid REFERENCES items(id) ON DELETE CASCADE,
  target    text NOT NULL,            -- 'mirror' | delivery_target UUID
  status    text NOT NULL DEFAULT 'mirrored' CHECK (status IN ('mirrored','failed')),
  at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, target)
);
