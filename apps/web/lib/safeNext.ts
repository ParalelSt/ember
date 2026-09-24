/** Where /auth?next= may send you after sign-in: a page on this site, or
 *  home (bughunt V2). Browsers read a backslash as a slash and drop tabs and
 *  newlines, so '/\example.com' and '/<tab>/example.com' are really
 *  '//example.com', another site. Anything carrying those is refused, and
 *  what is left must still resolve to this origin. */
export function safeNext(raw: string | null | undefined, origin: string): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return '/';
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return '/';
  }
  if (url.origin !== new URL(origin).origin) return '/';
  return url.pathname + url.search + url.hash;
}
