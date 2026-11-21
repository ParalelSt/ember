export type ListBoxLook = 1 | 2 | 3;

export const LIST_BOX_KEY = 'ember.design.listbox';

/** Temporary design switch. `?listbox=1|2|3` wins (and is remembered);
 *  otherwise the remembered pick; otherwise 1. */
export function readListBoxLook(): ListBoxLook {
  const parse = (v: string | null): ListBoxLook | null => (v === '1' ? 1 : v === '2' ? 2 : v === '3' ? 3 : null);
  try {
    const p = parse(new URLSearchParams(window.location.search).get('listbox'));
    if (p) {
      try { window.localStorage.setItem(LIST_BOX_KEY, String(p)); } catch { /* private mode */ }
      return p;
    }
  } catch { /* no window */ }
  try {
    const s = parse(window.localStorage.getItem(LIST_BOX_KEY));
    if (s) return s;
  } catch { /* storage blocked */ }
  return 1;
}
