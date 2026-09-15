-- Several delivery targets (FTP/SFTP sources), e.g. a second delivery target
-- folder or a different FTP server. Preset recipes can hardcode one target.
CREATE TABLE IF NOT EXISTS delivery_targets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  protocol     text CHECK (protocol IN ('ftps','sftp')),
  host         text,
  port         int,
  username     text,
  password_enc text,
  base_path    text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Preset → fixed target (NULL = the default delivery target from settings).
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS delivery_target_id uuid
  REFERENCES delivery_targets(id) ON DELETE SET NULL;

-- Folder → fixed target (optional).
ALTER TABLE folders ADD COLUMN IF NOT EXISTS delivery_target_id uuid
  REFERENCES delivery_targets(id) ON DELETE SET NULL;
