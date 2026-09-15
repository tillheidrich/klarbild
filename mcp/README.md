# Klarbild MCP server

Lets an AI assistant (e.g. Claude) hand images to Klarbild and have it process
them — things like "take the images from folder XY" or "process the photos
someone sent me over iMessage". The assistant fetches the image files (with its
own tools) and then calls the Klarbild tools.

## Setup

1. Generate a token in Klarbild: **Admin → "Automation / MCP access" → Generate token**.
2. Install the dependency: `npm i @modelcontextprotocol/sdk`
3. Start the server (or register it in your MCP client):

```json
{
  "mcpServers": {
    "klarbild": {
      "command": "node",
      "args": ["/path/to/mcp/klarbild-mcp.mjs"],
      "env": {
        "KLARBILD_URL": "https://klarbild.example.com",
        "KLARBILD_TOKEN": "klb_…"
      }
    }
  }
}
```

## Tools

- **list_recipes** — list the presets/recipes available.
- **process_images** — upload and process images (local paths or `data:` URLs).
  Give either `recipeId` (a preset) or `mode` (`each`/`compose`/`generate`) + options:
  `tasks` (`clean`/`cutout`/`format`/`contour`), `prompt_text`, `output_format`
  (fixed, like `30x40`/`tv169`, **or custom**, `25x35` / `sticker5`), `output_ext`
  (`png`/`jpg`, omit = global default), `orientation`, `crop_mode`, `contour_mm`,
  `delivery_folder`, `delivery`. Returns the job ID.
- **job_status** — query the status of a job (including finish time and error messages).

## Modules

Klarbild has optional modules, switched on with the `KLARBILD_MODULES` environment
variable (see `src/lib/modules.ts`). A tool that belongs to a disabled module
(for example `process_images` when the `ai` module is off, since it can start an
AI generation) returns a 404 from the Klarbild API — the MCP server surfaces that
as a tool error, it does not hide or special-case it.

## Security

The token grants full programmatic access to upload/processing (not to the admin
area). Treat it like a password; if you suspect it has leaked, generate a new one
(which invalidates the old one).
