-- Metadata sidecar file (.md) controllable per upload source instead of globally.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS delivery_metadata_sidecar bool NOT NULL DEFAULT false;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS mirror_metadata_sidecar     bool NOT NULL DEFAULT false;
ALTER TABLE delivery_targets ADD COLUMN IF NOT EXISTS metadata_sidecar  bool NOT NULL DEFAULT false;
