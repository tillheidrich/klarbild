import de from '../locales/de.json';
import { makeT, type Dict, type Locale, type TFunction } from './i18n';

/**
 * Server-side dictionaries. Only this module imports the JSON, so the bundler
 * keeps it out of the browser bundle; the layout passes the right one down.
 */
const DICTS: Partial<Record<Locale, Dict>> = { de: de as Dict };

/** The dictionary for a locale, or `null` for English, which needs none. */
export function dictFor(locale: Locale): Dict | null {
  return DICTS[locale] ?? null;
}

/** Convenience for Astro frontmatter: `const t = tFor(locale)`. */
export function tFor(locale: Locale): TFunction {
  return makeT(dictFor(locale));
}
