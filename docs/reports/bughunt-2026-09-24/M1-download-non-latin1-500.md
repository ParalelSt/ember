# M1. Downloading a song with a non-English title crashed

**What you'd notice:** Hitting "download" on a track whose title had Japanese, Cyrillic, or other non-Latin characters gave an error instead of the file.

**Why it happened:** The download filename was put straight into a response header, and browsers' header objects only accept plain English letters/numbers there. Anything else made the server throw instead of answering.

**What changed:** The header now carries the real name in the modern UTF-8 form, plus a safe English-only fallback name for older clients. Files: `apps/web/app/api/youtube/stream/[videoId]/route.ts` (Content-Disposition header).

**Compare:** before = `2a58f98`, after = `1a2e659`.
- Test: `npx vitest run "app/api/youtube/stream/[videoId]/route.test.ts"`: before, the non-Latin1 download test failed with `expected 500 to be 200`; after, all 7 tests pass.
- Screenshots: not visual.
- Try it yourself: download a track whose title has non-English characters with `?download=1`.

**Risk:** low, header-only change with a test covering the crash path.
