# 05. An expired session showed a garbled error instead of sending you to sign in

**What you'd notice:** if your session expired (came back after a while away), the app didn't send you back to sign in. Instead things quietly broke with a confusing error, because the app was trying to read the sign-in page's HTML as if it were data.

**Why it happened:** when a request had no valid session, the server always replied with a redirect to the sign-in page, even for background API calls the app makes (not just full page loads). The browser followed that redirect and handed back the sign-in page's HTML, which the app then tried to parse as JSON and failed.

**What changed:** an API call with no session now gets a plain "Unauthorized" answer instead of a redirect. The app recognizes that answer and sends you to sign in itself, remembering the page you were on so you land back there after logging in. Regular page loads (not API calls) still redirect the same way as before. Files: `apps/web/proxy.ts`, `apps/web/lib/api.ts`.

**Compare:** before = `9d0dad2`, after = `44389d1`.
- Test: `npx vitest run proxy.test.ts lib/api.test.ts`: fails before (`proxy.test.ts` got a 307 instead of 401; `lib/api.test.ts` never redirected), passes after: `Test Files 2 passed (2)`, `Tests 7 passed (7)`.
- HTTP check against a throwaway server (app :3053, PocketBase :8086, bughunt worktree migrations/hooks), no cookie: `GET /api/playlists` → `401 {"error":"Unauthorized"}` (was a 307 to `/auth` before). `GET /library` still redirects (307 to `/auth?next=%2Flibrary`), and a public path like `/api/search?q=` still works with no session.
- Screenshots: none, not visual.
- Try it yourself: needs a real expired session to see the redirect land in the browser; the JSON/redirect behavior above is confirmed directly against the server.
**Risk:** low, only changes the shape of the "not signed in" answer for API paths.
