-- Alternatives/regeneration: group several results under the same origin.
-- variant_of points at the "root" item (the first version); alternatives share it.
ALTER TABLE items ADD COLUMN IF NOT EXISTS variant_of uuid REFERENCES items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS items_variant_idx ON items(variant_of);
