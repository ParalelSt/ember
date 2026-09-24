'use client';

import { detectShell } from '@/lib/playback/detectShell';

/** Opening a link outside Ember: a new browser tab on the web, the system
 *  browser in the shells.
 *
 *  The desktop app's webview drops `target="_blank"` links and
 *  `window.open` (WKWebView with no new-window handler), which is why the
 *  tab page's "Find one" links did nothing there. On desktop the link goes
 *  to the shell's `open_external` command (apps/desktop/src-tauri/src/
 *  external.rs); a desktop build from before that command copies the link
 *  instead, so the listener can paste it. Capacitor already hands new-tab
 *  links to the system browser, so the phone apps and the web take the
 *  plain path. */

export type OpenOutcome = 'opened' | 'copied' | 'failed';

type TauriWindow = {
  __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown> };
};

/** Only web links leave the app. */
export function isExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

async function copy(url: string): Promise<OpenOutcome> {
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** Open `url`. On the web this calls `window.open` at once, inside the
 *  click that asked (a popup blocker only lets a click's own call through). */
export function openExternal(url: string): Promise<OpenOutcome> {
  if (!isExternalUrl(url)) return Promise.resolve('failed');
  if (detectShell() === 'tauri') {
    const invoke = (window as unknown as TauriWindow).__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== 'function') return copy(url);
    return Promise.resolve()
      .then(() => invoke('open_external', { url }))
      .then(
        () => 'opened' as const,
        () => copy(url),
      );
  }
  window.open(url, '_blank', 'noopener,noreferrer');
  return Promise.resolve('opened');
}

/** A new-tab link the page did not handle itself, clicked in the desktop
 *  app: open it in the system browser. Returns the uninstall function; a
 *  no-op outside the desktop shell. Bubble phase on the document, so a link
 *  with its own click handler (which prevents the default) is left to it. */
export function routeNewTabLinks(onOutcome?: (outcome: OpenOutcome, url: string) => void): () => void {
  if (typeof document === 'undefined' || detectShell() !== 'tauri') return () => {};
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a.target !== '_blank' || !isExternalUrl(a.href)) return;
    e.preventDefault();
    void openExternal(a.href).then((o) => onOutcome?.(o, a.href));
  };
  document.addEventListener('click', onClick);
  return () => document.removeEventListener('click', onClick);
}
