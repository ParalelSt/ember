import { isNewer } from '@/lib/semver';
import { sanitizeVersion, type DevicePlatform } from '@/lib/versions/label';

/** "Is there a newer Ember than the one running here?", for the update
 *  reminder (components/update/UpdateReminder) and Settings' Updates card.
 *
 *  Two things can be newer, and they are released separately:
 *
 *   - The web build. The desktop and phone apps load the page from the host,
 *     but a window that stays open keeps running the build it loaded: the
 *     host moving to 0.7.43 changes nothing in it until the page loads again
 *     (Next only reloads by itself on a page change that goes to the server,
 *     and the search overlay, playback and most of a session never do one).
 *     GET /api/version says what the host runs now; a reload brings it in.
 *   - The desktop app itself (the Tauri shell), from the same feed its
 *     launch dialog reads (GET /api/app/update). The shell downloads it in
 *     the background and installs it at the next launch.
 *
 *  Framework-free, every function is safe to call anywhere and never
 *  throws. */

export type UpdateKind = 'web' | 'shell';

/** What the reminder offers: one update, and whether a tap can apply it. */
export interface UpdateOffer {
  kind: UpdateKind;
  version: string;
  /** A tap can bring it in from the page: always for the web build; for the
   *  desktop app only from the shell version that can restart itself. */
  canApply: boolean;
}

export interface UpdateFindings {
  /** The host's web version, when it answered. */
  webLatest: string | null;
  /** The newest desktop app for this platform, when it answered. */
  shellLatest: string | null;
}

/** The first desktop app version with the `update_restart` command
 *  (apps/desktop/src-tauri/src/update.rs). Older ones install only through
 *  their launch dialog: quit and reopen. */
export const SHELL_RESTART_SINCE = '0.4.27';

const DESKTOP: readonly DevicePlatform[] = ['windows', 'macos', 'linux'];

export function isDesktopPlatform(platform: DevicePlatform): boolean {
  return DESKTOP.includes(platform);
}

export function shellCanRestart(shellVersion: string | null): boolean {
  return !!shellVersion && !isNewer(SHELL_RESTART_SINCE, shellVersion);
}

/** Newer, and both are real versions: a missing or malformed one is never
 *  an update. */
export function newer(candidate: string | null, current: string | null): boolean {
  const a = sanitizeVersion(candidate);
  const b = sanitizeVersion(current);
  return !!a && !!b && isNewer(a, b);
}

/** The one update worth a reminder. The desktop app first when the page can
 *  install it (a restart brings the new web build in too); else the web
 *  build, which a reload always can; else a desktop app that only a quit
 *  and reopen installs. Null when everything is current. */
export function pickOffer(
  found: UpdateFindings,
  running: { web: string | null; shell: string | null },
): UpdateOffer | null {
  const shell = newer(found.shellLatest, running.shell) ? sanitizeVersion(found.shellLatest) : null;
  const web = newer(found.webLatest, running.web) ? sanitizeVersion(found.webLatest) : null;
  const restart = shellCanRestart(sanitizeVersion(running.shell));
  if (shell && restart) return { kind: 'shell', version: shell, canApply: true };
  if (web) return { kind: 'web', version: web, canApply: true };
  if (shell) return { kind: 'shell', version: shell, canApply: false };
  return null;
}

const TIMEOUT_MS = 8000;

async function getJson(url: string, fetchImpl: typeof fetch): Promise<Record<string, unknown> | null> {
  const ctrl = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : undefined;
  try {
    const res = await fetchImpl(url, { cache: 'no-store', credentials: 'include', signal: ctrl?.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Asks the host. Null for anything it could not find out, so a failed check
 *  never looks like an update. `failed` is true when neither question got an
 *  answer. */
export async function findUpdates(
  running: { platform: DevicePlatform; shell: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateFindings & { failed: boolean }> {
  const web = getJson('/api/version', fetchImpl);
  const shellVersion = sanitizeVersion(running.shell);
  const shell =
    isDesktopPlatform(running.platform) && shellVersion
      ? getJson(
          `/api/app/update?platform=${running.platform}&version=${encodeURIComponent(shellVersion)}`,
          fetchImpl,
        )
      : Promise.resolve(null);
  const [w, s] = await Promise.all([web, shell]);
  const webLatest = sanitizeVersion(w?.version);
  const shellLatest = sanitizeVersion(s?.latest);
  return { webLatest, shellLatest, failed: w === null && s === null };
}
