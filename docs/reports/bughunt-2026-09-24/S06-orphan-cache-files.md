# S06. Downloaded songs with no track record left behind forever

**What you'd notice:** nothing user-facing directly, but the music cache folder on the host could slowly fill up with audio files for songs that no longer have anything pointing at them, taking up disk space forever.

**Why it happened:** the existing daily cleanup only ever deletes a cached file when it deletes the track row it found that file through. A file whose row was removed some other way (or a download that crashed right after writing the file but before its row was saved) was never looked at again — nothing walked the music folder itself to check.

**What changed:** the daily cleanup now also scans the music folder directly for `<videoId>.<ext>` files with no matching track row, and deletes the ones that are genuinely orphaned. To stay conservative about deleting audio: a file only counts if it's sat untouched for 30 days (a normal download's row lands within seconds, so a brand-new unmatched file is just a timing gap, not a leak); a video currently downloading is always skipped; and only a plain cached-audio filename counts, never a `.part`/`.ytdl` file still being written or anything else in that folder (an upload's audio lives in its own separate folder and never matches this filename shape anyway). Files: `apps/web/lib/cleanup.ts` (new orphan sweep, folded into `runCleanup`), `apps/web/lib/cleanup.test.ts` (8 new tests, all against a temp directory, never the real music cache).

**Compare:** before = `5bcc563`, after = `44b5192`.
- Test: `cd apps/web && npx vitest run lib/cleanup.test.ts`: before, all 8 tests fail (e.g. `AssertionError: expected undefined to be 1`, the report had no orphan fields yet); after, all 8 pass.
- Screenshots: not visual.
- Try it yourself: run the admin cleanup endpoint (dry run by default) and check `orphanScanned`/`orphanDeletedFiles` in the response.

**Not changed, flagged for the owner:** `plays.track` still cascade-deletes on a track row's removal, so deleting a stale track also wipes its play history. That's a schema decision, left alone here.

**Risk:** low. The sweep only ever deletes a file matching the exact `<videoId>.<ext>` shape, never touches anything currently downloading, and waits 30 days before treating an unmatched file as orphaned.
