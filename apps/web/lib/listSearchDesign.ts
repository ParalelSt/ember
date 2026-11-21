export type ListSearchDesign = 'a' | 'b';

export const LIST_SEARCH_DESIGN_KEY = 'ember.design.listsearch';

/** `?listsearch=a|b` wins (and is remembered); otherwise the remembered pick;
 *  otherwise a. */
export function readListSearchDesign(): ListSearchDesign {
  try {
    const p = new URLSearchParams(window.location.search).get('listsearch');
    if (p === 'a' || p === 'b') {
      try { window.localStorage.setItem(LIST_SEARCH_DESIGN_KEY, p); } catch { /* private mode */ }
      return p;
    }
  } catch { /* no window */ }
  try {
    const s = window.localStorage.getItem(LIST_SEARCH_DESIGN_KEY);
    if (s === 'a' || s === 'b') return s;
  } catch { /* storage blocked */ }
  return 'a';
}
