-- Trash instead of deleting for good ----------------------------------------
--
-- Deleting an image used to remove the row and the result file on the spot. One
-- slip in the library and the result was gone — including what it had cost to
-- generate. Now a delete only sets `deleted_at`. The image disappears from every
-- view, every share link and every delivery, and comes back unchanged when it is
-- restored. Maintenance removes it for good after `settings.trash_days`.
ALTER TABLE items ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS items_deleted_at_idx ON items (deleted_at) WHERE deleted_at IS NOT NULL;

-- 0 = no trash: a delete is final, as before.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS trash_days int NOT NULL DEFAULT 30;
