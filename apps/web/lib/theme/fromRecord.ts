import { parseThemeDoc, type ThemeDoc } from '@/lib/theme/model';

/** The active theme from a users record, as the root layout reads it from
 *  the `pb_auth` cookie. Null when there is no usable record: signed out,
 *  or a record the SDK stripped down to id, email, collection and verified
 *  because the cookie would have passed 4096 bytes (then the page paints
 *  Ember and the client's cached theme takes over after hydration). A full
 *  record always carries `created`; a stripped one never does. */
export function themeFromRecord(record: unknown): ThemeDoc | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.created !== 'string') return null;
  return parseThemeDoc(r.theme);
}
