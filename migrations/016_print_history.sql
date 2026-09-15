-- Print history: what was printed last --------------------------------------
--
-- Only the **recipe** is stored, not the result: the sheet settings, the
-- references to the source images, and a few key figures. An A3 print sheet
-- as a PDF is quickly 20–80 MB; a few dozen prints would fill the disk, and
-- with files that can be regenerated in seconds at that. The sheet is simply
-- recomputed on reprint — deterministic, from the same sources.
--
-- Row size: roughly 1–3 KB per entry. A thousand prints therefore cost a few
-- megabytes instead of many gigabytes.
CREATE TABLE IF NOT EXISTS print_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Where the print came from: 'web' | 'telegram' | 'mcp' | 'api'
  origin      text NOT NULL DEFAULT 'web',
  -- Human-readable short form for the list ("13 × 18 cm ×1, 35 × 45 mm ×8").
  summary     text,
  paper       text,                       -- "A4 · 210 × 297 mm"
  pages       integer NOT NULL DEFAULT 1,
  pieces      integer NOT NULL DEFAULT 1,
  bytes       integer,                    -- size of the generated PDF, informational only
  -- The full request that the sheet can be regenerated from.
  -- Deliberately the request body and not a bespoke format: what is stored
  -- here can be sent back to /api/print/sheet unchanged.
  config      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS print_runs_user_idx ON print_runs(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS print_runs_created_idx ON print_runs(created_at DESC);

-- Which library images went into a print. Only for images from the
-- library — individually uploaded files have no durable identifier and are
-- gone anyway once the sources are cleaned up.
CREATE TABLE IF NOT EXISTS print_run_items (
  run_id   uuid NOT NULL REFERENCES print_runs(id) ON DELETE CASCADE,
  item_id  uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (run_id, item_id)
);
CREATE INDEX IF NOT EXISTS print_run_items_item_idx ON print_run_items(item_id);
