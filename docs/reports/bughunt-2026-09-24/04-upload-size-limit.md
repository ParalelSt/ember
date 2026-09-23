# 04. Uploading a song over 12 MB failed with "No file uploaded"

**What you'd notice:** uploading a song file bigger than about 12 MB (a longer track, or a high-bitrate rip) failed instantly with "No file uploaded", even though the upload limit is advertised as 50 MB.

**Why it happened:** Next buffers every request that passes through the app's proxy up to a configured size, and silently keeps only the first part if the body is bigger, no error, just a truncated body. That buffer was set to 12 MB, well under the 50 MB the upload feature actually allows.

**What changed:** raised the buffer to 55 MB, comfortably above the 50 MB upload cap plus the multipart form overhead around it. Files: `apps/web/next.config.ts`.

**Compare:** before = `9d0dad2`, after = `609f3a4`.
- Test: `npx vitest run next.config.test.ts`: fails before (12mb ≤ the 50MB upload cap), passes after (55mb comfortably covers it): `Test Files 1 passed (1)`, `Tests 1 passed (1)`.
- HTTP check against a throwaway server (app :3053, PocketBase :8086, bughunt worktree migrations/hooks): `POST /api/uploads` with a 13 MB file. Before: `HTTP_STATUS:400 {"error":"No file uploaded"}`. After: `HTTP_STATUS:201 {"track":{"id":"upload:...","title":"Final Check",...}}`.
- Screenshots: none, not visual.
- Try it yourself: upload a song file over 12 MB from Library > Uploads.
**Risk:** low, a config number only.
