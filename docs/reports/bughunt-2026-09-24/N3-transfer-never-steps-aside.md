# N3. A long transfer never let a waiting import go first

**What you'd notice:** Start a big Liked-songs transfer, then import a playlist. The playlist sat on "Waiting" until the whole transfer (possibly thousands of songs) had finished.

**Why it happened:** Every ten batches the transfer did hand itself back to the queue, but the queue always picks the oldest job first, and the oldest job was the transfer itself. So it was picked straight back up, and the waiting import never got a turn.

**What changed:** When a transfer steps aside, the very next pick passes over it once, so the waiting import runs; after that the transfer carries on from where it stopped. If nothing else is waiting, it just continues. Files: `apps/web/lib/import/runner.ts` (remembers the job that stepped aside), `apps/web/lib/import/store.ts` (`claimNext` takes another queued job first).

**Compare:** before = `354716b`, after = `56a33fd`.
- Test: `cd apps/web && npx vitest run lib/import/runner.test.ts lib/import/store.test.ts`: fails before:
  `expected [ 'transfer', 'playlist' ] to deeply equal [ 'playlist', 'transfer' ]` (the playlist finished last)
  `claimNext > passes over a transfer that just stepped aside: expected 'transfer' to be 'playlist'`
  Passes after (49/49).
- Screenshots: not visual.
- Try it yourself: on the sandbox, start a transfer of a few hundred songs, then paste a short playlist link. After roughly 80 songs of the transfer, the playlist import runs to Done, then the transfer continues.

**Risk:** low. Only the order of the queue changes, and only right after a transfer steps aside.
