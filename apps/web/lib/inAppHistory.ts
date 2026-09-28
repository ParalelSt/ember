/** Leaving a page the way the listener came in: Back to the page before
 *  when that page was Ember's, else home. A plain `history.length > 1`
 *  cannot tell: a tab page opened from a link or a bookmark has the site
 *  the listener came from behind it, and Back would leave Ember.
 *
 *  Where the browser has the Navigation API it answers directly
 *  (`navigation.canGoBack` only counts this site's own entries). Elsewhere
 *  the app shell notes every page it shows (`notePathname`, from the
 *  player bar), and a page reached after another one was seen here was
 *  reached from inside Ember. */

let lastPath: string | null = null;
let movedInApp = false;

/** The app shell saw this page. Called on every pathname change. */
export function notePathname(pathname: string | null): void {
  if (!pathname) return;
  if (lastPath !== null && pathname !== lastPath) movedInApp = true;
  lastPath = pathname;
}

/** For tests: forget the pages seen. */
export function resetInAppHistory(): void {
  lastPath = null;
  movedInApp = false;
}

/** Is the entry before this one an Ember page? */
export function canGoBackInApp(): boolean {
  if (typeof window !== 'undefined') {
    const nav = (window as unknown as { navigation?: { canGoBack?: unknown } }).navigation;
    if (typeof nav?.canGoBack === 'boolean') return nav.canGoBack;
  }
  return movedInApp;
}

/** Close the page on screen: Back when the listener came from inside
 *  Ember, else home. */
export function leavePage(router: { back(): void; push(href: string): void }): void {
  if (canGoBackInApp()) router.back();
  else router.push('/');
}
