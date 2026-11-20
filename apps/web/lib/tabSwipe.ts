/** Swiping sideways on a phone tab page moves between the bottom tabs, in
 *  the bottom bar's order (components/nav/MobileNav, kept in step by
 *  components/nav/MobileNav.test): finger right to left is the next tab,
 *  left to right the one before, no wrap at either end. Only the tab pages
 *  themselves; a sub page or a sub view of one (Home's ?focus=) never
 *  swipes away. */

/** The bottom bar's tabs, left to right. */
export const PHONE_TABS = ['/', '/search', '/library'] as const;

/** How far a finger must travel sideways for the swipe to count. */
export const TAB_SWIPE_MIN_PX = 64;

/** Sideways must beat up-and-down by this much: a scroll that drifts is
 *  never a tab swipe. */
export const TAB_SWIPE_RATIO = 1.5;

/** Query params that make a tab's route a sub view rather than the tab. */
const SUB_VIEW_PARAMS: Record<string, readonly string[]> = { '/': ['focus', 'row'] };

export type TabSwipeDir = 'next' | 'prev';

/** Where this page sits in the bottom bar, or -1 when it is not a tab page. */
export function tabIndexFor(pathname: string | null | undefined, search = ''): number {
  if (!pathname) return -1;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
  const index = (PHONE_TABS as readonly string[]).indexOf(path);
  if (index < 0) return -1;
  const params = new URLSearchParams(search);
  if ((SUB_VIEW_PARAMS[path] ?? []).some((p) => params.has(p))) return -1;
  return index;
}

/** The tab a finished drag of (dx, dy) px goes to, or null for none. */
export function tabSwipeTarget({
  dx,
  dy,
  pathname,
  search = '',
  blocked = false,
}: {
  dx: number;
  dy: number;
  pathname: string | null | undefined;
  search?: string;
  /** The drag started somewhere that keeps sideways drags for itself. */
  blocked?: boolean;
}): { href: string; dir: TabSwipeDir } | null {
  if (blocked) return null;
  if (Math.abs(dx) < TAB_SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy) * TAB_SWIPE_RATIO) return null;
  const index = tabIndexFor(pathname, search);
  if (index < 0) return null;
  const dir: TabSwipeDir = dx < 0 ? 'next' : 'prev';
  const href = PHONE_TABS[index + (dir === 'next' ? 1 : -1)];
  return href ? { href, dir } : null;
}

/** Places a swipe may not start: typing, sliders, sheets and menus, and
 *  whatever marks itself `data-no-tab-swipe` (the mini player's own
 *  swipe-to-skip, Now Playing, the update pill). */
export const TAB_SWIPE_BLOCK_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="slider"]',
  '[data-slot="slider"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[data-no-tab-swipe]',
].join(', ');

function scrollsSideways(el: Element): boolean {
  if (el.scrollWidth <= el.clientWidth + 1) return false;
  try {
    return /(auto|scroll)/.test(getComputedStyle(el).overflowX);
  } catch {
    return false;
  }
}

/** True when a drag starting on `target` belongs to something else: a
 *  blocked element (see above) or anything between it and `boundary` that
 *  scrolls sideways itself (Home's rows, a chips row). */
export function isTabSwipeBlocked(target: EventTarget | null, boundary?: Element | null): boolean {
  let el: Element | null =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  if (!el) return true;
  if (el.closest(TAB_SWIPE_BLOCK_SELECTOR)) return true;
  for (; el && el !== boundary; el = el.parentElement) {
    if (scrollsSideways(el)) return true;
  }
  return false;
}

/** A sheet, dialog or menu is open over the page (Now Playing stays
 *  mounted, hidden with aria-hidden, while it is closed). */
export function hasOpenOverlay(doc: Document): boolean {
  return !!doc.querySelector(
    '[role="dialog"]:not([aria-hidden="true"]), [role="alertdialog"]:not([aria-hidden="true"]), [role="menu"]',
  );
}
