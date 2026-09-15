-- Make sessions revocable server-side ---------------------------------------
-- Until now the session cookie was only HMAC-signed: whoever had it once got
-- in with it indefinitely — even after the password was reset or the role
-- was taken away. The very step meant to rescue a hijacked account therefore
-- did not help.
--
-- `session_epoch` is incremented on every password change and every role
-- change. The cookie carries the value along; once it no longer matches, the
-- cookie is no longer valid. A counter instead of a timestamp, because it
-- knows no clock-skew inaccuracies.
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 0;

-- For rename assignment: `renames.ts` checks, for every finished image,
-- whether a name is already taken — without an index that was a full table scan.
CREATE INDEX IF NOT EXISTS items_filename_idx ON items(filename);

-- Cleanup: both tables grew without bound.
CREATE INDEX IF NOT EXISTS share_views_at_idx ON share_views(at);
CREATE INDEX IF NOT EXISTS password_resets_expires_idx ON password_resets(expires_at);

-- Counter for distinct visitors per share link. It used to be computed on every
-- load of the admin page via `count(DISTINCT ip_hash)` over share_views — that
-- got slow as the table grew, and made the page attackable, since anyone with
-- the link could generate an unlimited number of rows.
ALTER TABLE shares ADD COLUMN IF NOT EXISTS visitor integer NOT NULL DEFAULT 0;

-- Only one row per link, visitor and hour: without this limit, a recipient
-- (or an <img> tag on some page) could fill the table without bound and run
-- the disk out of space.
--
-- The hour value is supplied at write time instead of computed in the index:
-- `date_trunc` on a timestamptz depends on the timezone setting and is
-- therefore not immutable enough for an index.
ALTER TABLE share_views ADD COLUMN IF NOT EXISTS hour text;
CREATE UNIQUE INDEX IF NOT EXISTS share_views_once_per_hour_idx
  ON share_views (share_id, kind, ip_hash, hour)
  WHERE ip_hash IS NOT NULL AND hour IS NOT NULL;
