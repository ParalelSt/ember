# X9. Synced lyrics from the wrong version; a slow LRCLib stuck lyrics for an hour

**What you'd notice:** the highlighted lyric line runs ahead of or behind the song, because the timing came from a live or extended version. Or a song shows plain (or no) lyrics for an hour after LRCLib was slow once, even though it has synced ones.

**Why it happened:** the lookup took the first search result with timing, whatever its length. And when LRCLib timed out or errored, the fallback answer was saved for an hour as if LRCLib had simply had nothing.

**What changed:** the app now sends the song's length. Timed lyrics only come from a version within 3 s of it (the closest one wins); other versions give the words without timing. When LRCLib fails, the fallback still shows but is not saved, so the next try asks LRCLib again. A real "nothing found" is still saved. Files: `lib/sources/youtube.ts`, `app/api/lyrics/route.ts`, `hooks/useLyrics.ts`.

**Compare:** before = `7590480`, after = `5bc88f1`.
- Test: `cd apps/web && npx vitest run lib/sources/youtube-lyrics.test.ts app/api/lyrics/route.test.ts hooks/useLyrics.test.tsx`: fails before (7 of 9), passes after (9 of 9).
  - `× takes the synced lyrics whose length matches the track` / `expected { time: 10, text: 'live line' } to deeply equal { time: 5, text: 'studio line' }`
  - `× asks LRCLib again after a timeout` / `expected 'genius' to be 'lrclib'`
  - `× sends the track length with the lookup` / `expected null to be '213'`
- Try it yourself: play a song that has a well-known live version (for example a studio track whose live cut is a minute longer) and open lyrics: the highlight follows the singer.

**Risk:** low. The saved-answer key now includes the length, so old saved entries are simply looked up fresh once.
