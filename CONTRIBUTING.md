# Contributing

Thanks for looking. Klarbild is a small project with one maintainer, so the most
useful contributions are the ones that arrive ready to merge: a clear problem, a
minimal change, and a test where a test is possible.

## Getting it running

```bash
npm install
cp .env.example .env     # DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEY
npm run dev
```

You need a PostgreSQL to point `DATABASE_URL` at; `docker compose up db` gives you
one. Migrations run themselves on the first request.

```bash
npm test          # 124 tests, no database needed
npx tsc --noEmit  # must be clean
npm run build
```

Both `npm test` and `tsc` run in CI and both must be green.

## How the code is laid out

```
src/lib/print*.ts     the print engine — pure arithmetic, heavily tested
src/lib/paper.ts      86 image sizes, 19 paper formats, the size parser
src/lib/modules.ts    which optional modules are switched on
src/lib/i18n.ts       translation; the English sentence is the key
src/components/       React islands, one per screen
src/pages/            Astro pages and the API under src/pages/api/
migrations/           numbered SQL, forward-only, idempotent, run on boot
tests/                node:test, no framework
```

The rule that matters most: **the browser preview and the server-side PDF use the
same layout code.** If you change how a sheet is laid out, change it in
`src/lib/printlayout.ts` and both follow. Anything that recomputes geometry in a
component is a bug waiting to happen.

## House style

- Comments explain **why**, and carry the number that justifies the decision.
  "Measured: 440 MB of images peaked at 196 MB of memory" is worth more than
  "stream the files". Please keep that habit; it is most of what makes this
  codebase navigable.
- No new dependency without a reason in the pull request. There are 20 runtime
  dependencies and that is already plenty.
- Two-space indent, no semicolon crusade, no reformatting of files you did not
  otherwise touch.
- Metric units. English decimal point in English strings.

## Translation

The English string in the source **is** the key. To add a language:

1. Copy `src/locales/de.json` to `src/locales/<code>.json` and translate the values.
2. Add the code to `LOCALES` and `LOCALE_NAMES` in `src/lib/i18n.ts`, and to
   `DICTS` in `src/lib/i18n.server.ts`.

A missing key falls back to English, so a partial translation is still useful. Never
build a sentence by concatenation — use a named placeholder: `t('{done} of {total}
done', { done, total })`.

## Adding a module

Optional features live behind `src/lib/modules.ts`. A new one needs: an entry in
`MODULE_IDS` and `MODULE_INFO`, a `has('yours')` guard on its navigation entry and
its settings card, and `if (!has('yours')) return moduleOff('yours')` at the top of
every API route it owns. The test is simple — with the module off, the instance
should not hint that the feature exists.

## Pull requests

One change per pull request. Say what breaks if it is wrong. If you found a bug you
are not fixing, an issue with a reproduction is genuinely useful on its own.
