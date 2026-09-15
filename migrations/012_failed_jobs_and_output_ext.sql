-- Jobs may now also be "failed" (all items failed) → shown red in the overview.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('queued','running','paused','done','cancelled','failed'));

-- Output format of the image file: global (settings) + an optional preset override.
-- "png" = lossless (default, needed for transparency), "jpg" = small, friendly to the delivery target.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS output_ext text NOT NULL DEFAULT 'png'
  CHECK (output_ext IN ('png','jpg'));
ALTER TABLE recipes  ADD COLUMN IF NOT EXISTS output_ext text
  CHECK (output_ext IN ('png','jpg'));
