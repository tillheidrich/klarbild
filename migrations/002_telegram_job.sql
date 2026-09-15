-- Telegram: the job knows the chat that triggered it (for replying back).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS telegram_chat_id bigint;
