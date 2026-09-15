-- Klarbild — Initial schema (users, recipes, jobs, items, delivery, sharing, Telegram).
-- Applied automatically at startup (numbered SQL files, no ORM magic).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  display_name  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Preset recipes (saved presets) -------------------------------------------
CREATE TABLE IF NOT EXISTS recipes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  tasks              jsonb NOT NULL DEFAULT '[]'::jsonb,  -- e.g. ["clean","format","deliver"]
  output_format      text,
  orientation        text,
  crop_mode          text,
  dpi                int  NOT NULL DEFAULT 300,
  contour_mm         numeric,
  model_key          text,
  delivery           text NOT NULL DEFAULT 'library' CHECK (delivery IN ('library','remote','both')),
  delivery_folder    text,
  custom_instruction text,
  is_default         bool NOT NULL DEFAULT false,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Jobs (a batch) --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  origin          text NOT NULL DEFAULT 'web' CHECK (origin IN ('web','telegram')),
  recipe_snapshot jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','paused','done','cancelled')),
  total           int NOT NULL DEFAULT 0,
  done_count      int NOT NULL DEFAULT 0,
  failed_count    int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

-- Folders ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS folders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  delivery_folder text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Items (one image in a job) -----------------------------------------------
CREATE TABLE IF NOT EXISTS items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid REFERENCES jobs(id) ON DELETE CASCADE,
  position        int NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','done','failed','skipped')),
  attempts        int NOT NULL DEFAULT 0,
  error_message   text,
  source_path     text,
  result_path     text,
  filename        text,
  output_px       text,
  source_quality  text CHECK (source_quality IN ('original','compressed')),
  dpi             int,
  has_alpha       bool NOT NULL DEFAULT false,
  model_used      text,
  prompt_used     text,
  cost            numeric,            -- actual cost, from usage.cost
  folder_id       uuid REFERENCES folders(id) ON DELETE SET NULL,
  delivery_status text NOT NULL DEFAULT 'none'
                    CHECK (delivery_status IN ('none','pending','delivered','failed')),
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS items_job_idx ON items(job_id);
CREATE INDEX IF NOT EXISTS items_created_idx ON items(created_at DESC);

-- Print jobs ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS print_jobs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  note       text,
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS print_job_items (
  print_job_id uuid REFERENCES print_jobs(id) ON DELETE CASCADE,
  item_id      uuid REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (print_job_id, item_id)
);

-- Share links -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS share_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token         text UNIQUE NOT NULL,
  scope_type    text NOT NULL CHECK (scope_type IN ('selection','folder')),
  scope_ref     jsonb NOT NULL,
  expires_at    timestamptz,
  password_hash text,
  revoked       bool NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Telegram ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telegram_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id           bigint UNIQUE NOT NULL,
  user_id           uuid REFERENCES users(id) ON DELETE CASCADE,
  default_recipe_id uuid REFERENCES recipes(id) ON DELETE SET NULL,
  active            bool NOT NULL DEFAULT true,
  linked_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS telegram_pairing_codes (
  code       text PRIMARY KEY,
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE TABLE IF NOT EXISTS telegram_drafts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id          bigint NOT NULL,
  media_group_id   text,
  file_refs        jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_received_at timestamptz NOT NULL DEFAULT now(),
  status           text NOT NULL DEFAULT 'collecting'
                     CHECK (status IN ('collecting','awaiting_recipe','dispatched','discarded')),
  notice_message_id bigint
);

-- Settings (single row) -----------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  id                   int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  openrouter_key_enc   text,
  delivery_host         text,
  delivery_protocol     text CHECK (delivery_protocol IN ('ftps','sftp')),
  delivery_port         int,
  delivery_user         text,
  delivery_password_enc text,
  delivery_base_path    text,
  default_dpi          int NOT NULL DEFAULT 300,
  default_crop_mode    text NOT NULL DEFAULT 'crop',
  concurrency          int NOT NULL DEFAULT 2,
  cricut_sheet_cm      text NOT NULL DEFAULT '17.1x23.5',
  monthly_budget       numeric,
  n8n_webhook_url      text,
  telegram_bot_token_enc text,
  telegram_webhook_secret text
);

-- Models ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS models (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id       text NOT NULL,
  label          text NOT NULL,
  description    text,
  active         bool NOT NULL DEFAULT true,
  is_default     bool NOT NULL DEFAULT false,
  supports_alpha bool NOT NULL DEFAULT false,
  sort           int NOT NULL DEFAULT 0
);
