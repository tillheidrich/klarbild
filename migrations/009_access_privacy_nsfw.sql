-- Access rights, private sessions, NSFW switch.

-- Visibility of the library + privacy.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS library_visibility text NOT NULL DEFAULT 'own'
  CHECK (library_visibility IN ('own','shared'));   -- own = each user sees only their own; shared = everyone sees everything
ALTER TABLE settings ADD COLUMN IF NOT EXISTS anonymous_generations bool NOT NULL DEFAULT false;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS private_allowed bool NOT NULL DEFAULT false;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS allow_nsfw bool NOT NULL DEFAULT false;

-- Per user: force private sessions.
ALTER TABLE users ADD COLUMN IF NOT EXISTS private_forced bool NOT NULL DEFAULT false;

-- Private jobs: generate only, then forget (not in the library, no delivery/backup,
-- no stored prompt, sources deleted immediately, result removed after a short time).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS private bool NOT NULL DEFAULT false;

-- Flag models as NSFW-capable (selectable/visible only while allow_nsfw is on).
ALTER TABLE models ADD COLUMN IF NOT EXISTS nsfw bool NOT NULL DEFAULT false;
