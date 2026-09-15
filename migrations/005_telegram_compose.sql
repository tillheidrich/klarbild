-- Telegram: combine/generate — caption as description + an in-between status.
ALTER TABLE telegram_drafts ADD COLUMN IF NOT EXISTS caption text;
ALTER TABLE telegram_drafts DROP CONSTRAINT IF EXISTS telegram_drafts_status_check;
ALTER TABLE telegram_drafts ADD CONSTRAINT telegram_drafts_status_check
  CHECK (status IN ('collecting','awaiting_recipe','awaiting_compose_text','dispatched','discarded'));
