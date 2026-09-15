-- Presets for passport photos/print sheets ("daycare set", "8× passport photo") ---
CREATE TABLE IF NOT EXISTS print_presets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  config     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS print_presets_name_idx ON print_presets(name);

-- Telegram: state "waiting for print selection" -----------------------------
ALTER TABLE telegram_drafts DROP CONSTRAINT IF EXISTS telegram_drafts_status_check;
ALTER TABLE telegram_drafts ADD CONSTRAINT telegram_drafts_status_check
  CHECK (status IN ('collecting','awaiting_recipe','awaiting_compose_text','awaiting_print','dispatched','discarded'));
