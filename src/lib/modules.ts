/**
 * Optional modules.
 *
 * Klarbild ships as one codebase but not as one product. The print studio is the
 * core and is always on; everything that needs an outside account — an image model,
 * a bot, an SMTP mailbox, a remote server to deliver to — is a module you switch on
 * only if you want it. A print-only install therefore needs no API key, no bot
 * token and no mailbox, and the user interface simply does not show those parts.
 *
 * Configure with the `KLARBILD_MODULES` environment variable, comma separated:
 *
 *   KLARBILD_MODULES=print                  # default: the print studio, nothing else
 *   KLARBILD_MODULES=print,ai,share         # add image generation and share links
 *   KLARBILD_MODULES=all                    # everything
 *
 * `print` is implied even if you leave it out — there is no build of Klarbild
 * without it.
 */

export const MODULE_IDS = ['print', 'ai', 'delivery', 'mirror', 'share', 'mail', 'telegram'] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

/** What each module adds, in one line — used by the admin page and by `--help` style output. */
export const MODULE_INFO: Record<ModuleId, { title: string; summary: string; needs: string }> = {
  print: {
    title: 'Print studio',
    summary: 'Exact physical sizes, sheet layout with crop marks, tiling, PDF at 1:1.',
    needs: 'Nothing beyond the database and a volume.',
  },
  ai: {
    title: 'Image generation',
    summary: 'Clean up, convert, combine and generate images with an image model.',
    needs: 'An OpenRouter API key (paid, per image).',
  },
  delivery: {
    title: 'Delivery to a remote target',
    summary: 'Push finished files to an SFTP or FTPS server, plus extra targets.',
    needs: 'A server you already have, and its credentials.',
  },
  mirror: {
    title: 'Backup mirror',
    summary: 'Copy every finished file to a second SFTP/FTPS target, sorted by month.',
    needs: 'A second server or a network drive that speaks SFTP/FTPS.',
  },
  share: {
    title: 'Share links',
    summary: 'Public, expiring, revocable links to a single image or a whole set.',
    needs: 'A publicly reachable URL for this instance.',
  },
  mail: {
    title: 'Email',
    summary: 'Password reset, job notifications and sending share links by mail.',
    needs: 'An SMTP mailbox of your own.',
  },
  telegram: {
    title: 'Telegram bot',
    summary: 'Use Klarbild from a chat instead of the browser.',
    needs: 'A bot token from @BotFather and a public webhook URL.',
  },
};

function parse(raw: string | undefined): Set<ModuleId> {
  const on = new Set<ModuleId>(['print']); // never optional
  const value = (raw ?? '').trim();
  if (!value) return on;
  if (value.toLowerCase() === 'all') return new Set(MODULE_IDS);
  for (const piece of value.split(',')) {
    const id = piece.trim().toLowerCase() as ModuleId;
    if ((MODULE_IDS as readonly string[]).includes(id)) on.add(id);
    else if (id) console.warn(`[modules] unknown module "${id}" ignored (known: ${MODULE_IDS.join(', ')})`);
  }
  return on;
}

const enabled = parse(process.env.KLARBILD_MODULES);

/** True if the module is switched on for this instance. */
export function has(id: ModuleId): boolean {
  return enabled.has(id);
}

/** The switched-on modules, in declaration order. Safe to send to the browser. */
export function activeModules(): ModuleId[] {
  return MODULE_IDS.filter((id) => enabled.has(id));
}

/**
 * Guard for API routes belonging to a module that is off.
 *
 * Returning 404 rather than 403 is deliberate: to the outside world a module that
 * is off does not exist, so a disabled instance leaks nothing about what it could
 * have done.
 */
export function moduleOff(id: ModuleId): Response {
  return new Response(JSON.stringify({ error: `Module "${id}" is not enabled on this instance.` }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}
