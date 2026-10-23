/** Longer than any real search; a bigger q only costs the Python search.
 *  GET /api/search refuses more, and api.search never sends more. */
export const MAX_SEARCH_QUERY_LEN = 200;
