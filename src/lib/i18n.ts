/**
 * Translation.
 *
 * The English sentence *is* the key. `t('Sheet layout')` returns "Sheet layout"
 * in English and looks up "Bogen-Layout" in `locales/de.json` when the instance
 * runs in German. That has two consequences worth knowing:
 *
 *  - There is no key file to keep in sync and no `print.sheet.title` indirection
 *    to decode. You read the source and you see the sentence the user sees.
 *  - A missing translation degrades to English rather than to a raw key, so a
 *    half-finished locale is still a usable instance.
 *
 * Placeholders are named and written in braces: `t('{done} of {total} done',
 * { done, total })`. Never build a sentence by concatenation — word order
 * differs between languages, and a concatenated sentence cannot be translated.
 *
 * This module deliberately imports no dictionary. English needs none, and a
 * static import would ship every other language to every visitor. The server
 * loads the dictionary from `i18n.server.ts`; the browser picks it up from the
 * JSON block the layout renders (see `useT.ts`).
 */

export const LOCALES = ['en', 'de'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
};

export type Dict = Record<string, string>;
export type TFunction = (text: string, vars?: Record<string, string | number>) => string;

/** A translate function bound to one dictionary. Cheap — make one per render. */
export function makeT(dict?: Dict | null): TFunction {
  return (text, vars) => {
    let out = dict?.[text] ?? text;
    if (vars) {
      for (const [key, value] of Object.entries(vars)) {
        out = out.split('{' + key + '}').join(String(value));
      }
    }
    return out;
  };
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Which language this request gets.
 *
 * Order: an explicit `?lang=` in the URL (which also sets the cookie), then the
 * cookie, then the instance default from `KLARBILD_LOCALE`, then English. The
 * browser's `Accept-Language` deliberately does not decide: a self-hosted tool
 * belongs to its operator, and an instance set up in German should not flip to
 * English because a visitor's laptop is configured that way.
 */
export function resolveLocale(opts: { query?: string | null; cookie?: string | null; env?: string | null }): Locale {
  if (isLocale(opts.query)) return opts.query;
  if (isLocale(opts.cookie)) return opts.cookie;
  if (isLocale(opts.env)) return opts.env;
  return 'en';
}

export const LOCALE_COOKIE = 'klarbild_lang';

/** Where the layout parks the dictionary for the browser to find. */
export const DICT_ELEMENT_ID = 'klarbild-i18n';
