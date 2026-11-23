/** A path with its ids taken out, so timings group by page or endpoint and
 *  never carry a song, playlist or user id. A segment stays only when it is
 *  a short lowercase word (`settings`, `liked`, `api`); anything else (ids,
 *  names, encoded text) becomes `:id`. The query is dropped. */
export function routeShape(pathOrUrl: string): string {
  let path = pathOrUrl;
  const q = path.search(/[?#]/);
  if (q >= 0) path = path.slice(0, q);
  if (/^[a-z]+:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return '/:id';
    }
  }
  if (path.startsWith('/_next/')) return path.startsWith('/_next/image') ? '/_next/image' : '/_next/static';
  const parts = path.split('/').filter(Boolean).slice(0, 8);
  const shaped = parts.map((seg) => (/^[a-z][a-z-]{0,23}$/.test(seg) ? seg : ':id'));
  return '/' + shaped.join('/');
}

/** True for a request Next's router makes for a page's server data. */
export function isRscUrl(url: string): boolean {
  return /[?&]_rsc=/.test(url);
}
