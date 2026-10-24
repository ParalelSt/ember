/** Longer than any real search; a bigger q only costs the Python search.
 *  GET /api/search refuses more, and api.search never sends more. */
export const MAX_SEARCH_QUERY_LEN = 200;

/** The query as api.search sends it: trimmed and cut to the limit, never
 *  in the middle of an emoji (half of one is a lone surrogate, which
 *  encodeURIComponent refuses with "URI malformed"). */
export function clipSearchQuery(q: string): string {
  const cut = q.trim().slice(0, MAX_SEARCH_QUERY_LEN);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}
