# S01. A YouTube rate limit marked songs permanently unavailable

**What you'd notice:** after a burst of plays or cache warming, a batch of perfectly fine songs turned grey ("unavailable") for every listener and stayed that way.

**Why it happened:** when YouTube rate-limits the server, yt-dlp's message starts with "Video unavailable. This content isn't available, try again later". Ember looked for "Video unavailable", decided the video was gone for good, and flagged the song in the database.

**What changed:** the rate-limit wording ("try again later", "rate-limited") is now on the list of temporary failures, which is checked before the "gone for good" rules. A rate-limited play is now an ordinary retryable error (502), not a 410 that flags the song. Files: `apps/web/lib/sources/youtube.ts` (TRANSIENT_RE), `apps/web/lib/sources/youtube.test.ts` (new tests with the exact yt-dlp 2026.08.19 message).

**Compare:** before = `9d0dad2e5f7b92a2872547987b9d0c4b13591700`, after = `22914276492b6888503392def455e05ac24f9bf2`.
- Test: `cd apps/web && npx vitest run lib/sources/youtube.test.ts`: before, 2 of 7 fail (`classifyYtdlpFailure(...)` returned `'unavailable'` instead of null; the stream resolve failed with `isUnavailableError: expected true to be false`); after, all 7 pass, including a check that a truly removed video is still flagged.
- Screenshots: not visual.
- Try it yourself: needs YouTube to actually rate-limit the server, which can't be triggered on demand.

**Risk:** low. Only messages containing "try again later" or "rate-limited" change; songs already greyed by this bug are not cleared by this fix; the flag only lifts when one of them streams successfully again.
