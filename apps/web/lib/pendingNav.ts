'use client';

import { useSyncExternalStore, type PointerEvent } from 'react';

/** Instant tap feedback for the nav. A route change waits on the host, so on
 *  a slow link the tapped item used to sit unlit and the tap looked ignored.
 *  The tap is remembered here as "going to href, leaving `from`"; the nav
 *  lights that item at once. It lets go when the route changes (pathname is
 *  no longer `from`) or after PENDING_NAV_MS, whichever comes first. One
 *  store for all the navs (sidebar, drawer, bottom bar, car rail) so tapping
 *  one dims the item that was lit in its sibling. */
export const PENDING_NAV_MS = 10_000;

interface Pending {
  href: string;
  from: string;
}

let pending: Pending | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function clear() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (pending) {
    pending = null;
    emit();
  }
}

/** A tap on a nav link to `href` while on `from`. A tap on where we already
 *  are changes nothing. */
export function startPendingNav(href: string, from: string): void {
  if (href === from) return;
  if (pending?.href === href && pending.from === from) return;
  if (timer) clearTimeout(timer);
  pending = { href, from };
  timer = setTimeout(clear, PENDING_NAV_MS);
  emit();
}

/** The press was not a tap after all (a scroll, a drag off the item). */
export function cancelPendingNav(href: string): void {
  if (pending?.href === href) clear();
}

/** Test hook: forget everything. */
export function resetPendingNav(): void {
  clear();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The href the user just tapped and is still waiting on, or null. `pathname`
 *  is the current route: once it moves off the page the tap started from, the
 *  wait is over. */
export function usePendingNav(pathname: string): string | null {
  const p = useSyncExternalStore(subscribe, () => pending, () => null);
  return p && p.from === pathname ? p.href : null;
}

function plainPress(e: { button?: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) {
  return !(e.button && e.button !== 0) && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
}

/** Pointer handlers for a nav link: lights the item on press, un-lights it
 *  if the press turns into a scroll. The click itself is handled by the
 *  caller via onNav (it also fires for keyboard activation). */
export function pendingNavHandlers(href: string, from: string, enabled = true) {
  if (!enabled) return {};
  return {
    onPointerDown: (e: PointerEvent) => {
      if (plainPress(e)) startPendingNav(href, from);
    },
    onPointerCancel: () => cancelPendingNav(href),
    onPointerLeave: () => cancelPendingNav(href),
  };
}

/** Click side of the same: call from onClick for a navigation (not for the
 *  search item that opens an overlay). */
export function pendingNavClick(
  e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  href: string,
  from: string,
): void {
  if (plainPress(e)) startPendingNav(href, from);
}
