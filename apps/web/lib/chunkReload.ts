/** A server rebuilt while a tab stayed open leaves the old page asking for
 *  chunk files that no longer exist ("Loading chunk 5897 failed"). The cure
 *  is one full reload, which fetches the new build. This module detects that
 *  failure and reloads once, with a sessionStorage guard so a chunk that is
 *  really broken cannot loop the page. Framework-free like the rest of lib/.
 *
 *  There is no "new version available" mechanism in the app to reuse
 *  (/api/version only reports the server's version), and playback state is
 *  not saved across reloads anywhere, so a reload stops the music. That is
 *  why it only happens after an actual chunk failure, when the page is
 *  already broken. */

const GUARD_KEY = 'ember.chunkReload.at';
/** One automatic reload per this window; a failure inside it is treated as
 *  real and falls through to the normal error UI. */
export const RELOAD_WINDOW_MS = 30_000;
/** A link click counts as "where the user was going" for this long. */
const INTENT_MS = 10_000;

const CHUNK_MESSAGE = /Loading (CSS )?chunk [\w-]+ failed/;

let intent: { href: string; at: number } | null = null;
let installed = false;

export function isChunkLoadError(err: unknown, message?: string): boolean {
  if (err && typeof err === 'object' && (err as { name?: unknown }).name === 'ChunkLoadError') return true;
  const msg = message ?? (err instanceof Error ? err.message : typeof err === 'string' ? err : '');
  return CHUNK_MESSAGE.test(msg);
}

/** Remembers the last internal link the user pressed, so the reload lands
 *  where they were headed rather than where they were. */
export function installNavigationIntent(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.origin !== window.location.origin) return;
      intent = { href: a.pathname + a.search + a.hash, at: Date.now() };
    },
    true,
  );
}

function targetUrl(now: number): string {
  if (intent && now - intent.at <= INTENT_MS) return intent.href;
  return window.location.pathname + window.location.search + window.location.hash;
}

/** True when a reload was started (the caller should then not report the
 *  failure). False when the guard already fired recently, or storage is
 *  unusable (cannot prove it will not loop): show the error UI as before. */
export function reloadForChunkFailure(now: number = Date.now()): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const last = Number(window.sessionStorage.getItem(GUARD_KEY));
    if (last && now - last < RELOAD_WINDOW_MS) return false;
    window.sessionStorage.setItem(GUARD_KEY, String(now));
  } catch {
    return false;
  }
  const url = targetUrl(now);
  if (url === window.location.pathname + window.location.search + window.location.hash) {
    window.location.reload();
  } else {
    window.location.assign(url);
  }
  return true;
}

export function resetChunkReloadForTests(): void {
  intent = null;
}
