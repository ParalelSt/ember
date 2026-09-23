# N4. The Liked page downloaded every transfer song every 2 seconds

**What you'd notice:** With a big transfer running (thousands of songs), the Liked page grew sluggish and used a lot of data and server time: every 2 seconds it downloaded the full list of every song in the transfer, even though only a handful had changed.

**Why it happened:** The page asked for the transfer's complete song list on a 2-second timer for as long as the transfer ran, on top of the small progress summary it was already polling.

**What changed:** While the transfer runs, only the small summary is polled. The full song list is fetched once, and again only when something shown from it changes: a song needs a look, a song was not found, or the transfer stops or finishes. Between fetches, songs the transfer has already passed stop showing as "waiting". Files: `apps/web/hooks/useImports.ts` (`useLikedImportJob`). The playlist page is unchanged.

**Compare:** before = `2f3e654`, after = `de485b9`.
- Test: `cd apps/web && npx vitest run hooks/useLikedImportJob.test.tsx`: fails before:
  `polls the small jobs list, not every item: expected "vi.fn()" to be called 1 times, but got 4 times`
  Passes after (2/2).
- Screenshots: not visual (the page looks the same; only the network traffic drops).
- Try it yourself: on the sandbox, start a transfer of a few hundred songs, open Liked songs, and watch the browser's Network tab: `/api/import/jobs` every 2 s, `/api/import/jobs/<id>` only when a song lands in review/not found and at the end.

**Risk:** low. One trade-off: "Re-match" on a song liked since the last full fetch appears once the next fetch happens (at the latest when the transfer ends).
