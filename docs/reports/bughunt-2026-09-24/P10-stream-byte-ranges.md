# P10. The audio streaming route mishandled some byte ranges

**What you'd notice:** on the desktop app or in some browsers, certain seeks or partial downloads could serve the wrong chunk of a song, or fail outright with a server error instead of a clean "can't do that" response.

**Why it happened:** when a player asks for "the last N bytes" of a file (used when it wants to check the end of a song first), the server read that request as "the first N bytes" instead. When a player asked for bytes past the end of the file, the server tried to satisfy it anyway and crashed instead of saying so cleanly. And when a request asked for more bytes than the file has, the server claimed it would send more data than it actually sent.

**What changed:** the stream route now recognizes a "last N bytes" request and serves the true end of the file, answers a past-the-end request with the standard "range not satisfiable" response instead of crashing, and clamps an oversized end so the byte count it promises always matches what it sends. Ordinary ranges and full-file downloads (no range header) are untouched. Files: `apps/web/app/api/youtube/stream/[videoId]/route.ts` (serveFile), `apps/web/app/api/youtube/stream/[videoId]/route.test.ts` (new test).

**Compare:** before = `8d786fddcc478c98e92539d971284431a436814f`, after = `50d1991884a3234b14fc6b4e2218c2aa50e9eaef`.
- Test: `npx vitest run "app/api/youtube/stream/[videoId]/route.test.ts"`: before, 3 of 6 fail (`bytes=-100` returned `bytes 0-100/1000` instead of `bytes 900-999/1000`; `bytes=5000-` on a 1000-byte file returned 500 instead of 416; `bytes=0-4999` claimed `Content-Range: bytes 0-4999/1000` while only sending 1000 bytes); after, all 6 pass, including the two added regression checks for a normal range and a full-file 200.
- Screenshots: not visual.
- Try it yourself: needs a real player doing partial-range requests (desktop app or a manual curl with a Range header); no simple sandbox click reproduces it.

**Risk:** low. Normal ranges and the no-range full-file path use the same code paths as before, only the three edge cases changed.
