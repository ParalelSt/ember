/** Which UI this device shows: the redesign ('new') or the Classic look
 *  ('legacy', the UI frozen in apps/web/legacy/). One build carries both;
 *  a per-device cookie picks one, and only the server ever sets it
 *  (POST /api/ui-mode, or `?ui=legacy` / `?ui=new` on any page, see proxy.ts).
 *  The root layout reads it and puts it on <html data-ui>. */

export type UiMode = 'new' | 'legacy';

export const UI_MODE_COOKIE = 'ember_ui';

/** The query parameter that switches a device from any link. */
export const UI_MODE_PARAM = 'ui';

/** One year: the choice should outlive any reasonable gap between visits. */
export const UI_MODE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseUiMode(value: unknown): UiMode | null {
  return value === 'new' || value === 'legacy' ? value : null;
}

/** What a device with no cookie gets: EMBER_DEFAULT_UI, read at request time
 *  so a host can flip the default with a restart and no rebuild. */
export function defaultUiMode(env: string | undefined = process.env.EMBER_DEFAULT_UI): UiMode {
  return parseUiMode(env?.trim()) ?? 'new';
}

/** The device's cookie when it holds a known mode, else the default. */
export function resolveUiMode(cookieValue: string | undefined | null, env?: string): UiMode {
  return parseUiMode(cookieValue) ?? defaultUiMode(env);
}

/** A Set-Cookie header value for the mode. */
export function uiModeSetCookie(mode: UiMode, secure: boolean): string {
  const parts = [`${UI_MODE_COOKIE}=${mode}`, 'Path=/', `Max-Age=${UI_MODE_MAX_AGE}`, 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** The mode a Cookie header (or document.cookie) names, null when none. */
export function uiModeFromCookieHeader(header: string | null | undefined): UiMode | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === UI_MODE_COOKIE) return parseUiMode(rest.join('='));
  }
  return null;
}
