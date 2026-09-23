# M5. Two in-memory caches could grow forever

**What you'd notice:** Nothing directly, but the server's memory use for stream-URL and lyrics lookups would slowly climb the longer it stayed up, one entry per song ever played or looked up.

**Why it happened:** Both caches were plain, unbounded lookup tables keyed by song id or title+artist. The existing search cache already had a size cap; these two never got one.

**What changed:** Both caches now follow the same "drop the oldest entry once we hit the cap" pattern the search cache already used, capped at 500 entries each. Files: `apps/web/lib/sources/youtube.ts` (URL_CACHE, LYRICS_CACHE, new `capInsert` helper).

**Compare:** before = `3915baa`, after = `17b54e3`.
- Test: `npx vitest run lib/sources/youtube-cache-cap.test.ts`: before, `expected +0 to be 1` (the oldest entry was still cached, unbounded); after, it was evicted and resolved fresh.
- Screenshots: not visual.
- Try it yourself: needs long-running memory growth to see directly; covered by the unit test instead.

**Risk:** low, same eviction shape already used by the search cache in the same file.
