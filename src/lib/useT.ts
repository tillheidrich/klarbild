import { useMemo } from 'react';
import { makeT, DICT_ELEMENT_ID, type Dict, type Locale, type TFunction } from './i18n';

/**
 * Translation inside a React island.
 *
 * The dictionary is not bundled. The layout renders it once per page as an inert
 * `<script type="application/json">` block, and this reads it from there — so an
 * English instance downloads no dictionary at all, and a German one downloads it
 * once, as part of the HTML it was already fetching. Reading it is synchronous,
 * which matters: an island must not render English and then flicker into German.
 *
 * Server-side rendering has no `document`, so the island also accepts the
 * dictionary as a prop. English is the floor in every case, which means no
 * component is ever left without a working `t`.
 */
let cached: Dict | null | undefined;

function fromDocument(): Dict | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (typeof document !== 'undefined') {
    const el = document.getElementById(DICT_ELEMENT_ID);
    if (el?.textContent) {
      try { cached = JSON.parse(el.textContent) as Dict; } catch { cached = null; }
    }
  }
  return cached;
}

export function useT(dict?: Dict | Locale | null): TFunction {
  return useMemo(() => {
    // Pages pass the dictionary; older call sites pass a locale string, which
    // carries no dictionary and simply falls through to the document.
    const d = dict && typeof dict === 'object' ? dict : fromDocument();
    return makeT(d);
  }, [dict]);
}

export type { Locale, TFunction, Dict };
