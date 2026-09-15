-- Sending email, password reset, and share links ---------------------------
-- All forward-only and idempotent, like the other migrations.

-- SMTP access. The password is stored AES-256-GCM encrypted, like the other
-- secrets (src/lib/crypto.ts) — never in plain text.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS smtp_host     text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS smtp_port     integer NOT NULL DEFAULT 465;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS smtp_secure   boolean NOT NULL DEFAULT true;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS smtp_user     text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS smtp_password text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS smtp_from     text;

-- How long a new share link is valid by default (0 = unlimited).
ALTER TABLE settings ADD COLUMN IF NOT EXISTS share_default_days integer NOT NULL DEFAULT 30;

-- Email on the user account: for "forgot password" and optional notices.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email        text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_jobs  boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (lower(email)) WHERE email IS NOT NULL;

-- Password reset. Only the **hash** of the token is stored — reading the
-- database alone is not enough to take over an account.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id);

-- Share links: one image or a collection, publicly reachable at /s/<slug>.
CREATE TABLE IF NOT EXISTS shares (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text UNIQUE NOT NULL,
  kind           text NOT NULL DEFAULT 'item' CHECK (kind IN ('item','collection')),
  title          text,
  note           text,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at     timestamptz,
  revoked_at     timestamptz,
  allow_download boolean NOT NULL DEFAULT true,
  -- Optional passphrase (argon2), so a forwarded link alone is not enough.
  password_hash  text,
  views          integer NOT NULL DEFAULT 0,
  downloads      integer NOT NULL DEFAULT 0,
  last_seen_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shares_created_by_idx ON shares(created_by);

CREATE TABLE IF NOT EXISTS share_items (
  share_id uuid NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  item_id  uuid NOT NULL REFERENCES items(id)  ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (share_id, item_id)
);
CREATE INDEX IF NOT EXISTS share_items_item_idx ON share_items(item_id);

-- Accesses per link. The IP is stored only **hashed** (salted with the server's
-- secret): this lets you count returning visitors without identifying anyone
-- or recovering the address.
CREATE TABLE IF NOT EXISTS share_views (
  id         bigserial PRIMARY KEY,
  share_id   uuid NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  kind       text NOT NULL DEFAULT 'view' CHECK (kind IN ('view','download')),
  ip_hash    text,
  user_agent text,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS share_views_share_idx ON share_views(share_id, at DESC);
