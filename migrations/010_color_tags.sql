-- Color tags, as in the delivery target (red / orange / green / final).
ALTER TABLE items ADD COLUMN IF NOT EXISTS color_tag text
  CHECK (color_tag IN ('red','orange','green','final'));
CREATE INDEX IF NOT EXISTS items_color_tag_idx ON items(color_tag);
