# W01. The server believed whatever the login cookie said about you
**Status:** fixed.
**What you'd notice:** nothing in normal use. The risk: the browser keeps a copy of "who you are" (your account id, whether you're an admin) next to the real login token, and anyone can edit that copy in their own browser. A signed-in member could claim to be admin and use every admin screen, or claim to be another member and, for example, delete that member's uploads. On links ending in ".js", even someone with a made-up login got as far as the admin code.
**Why it happened:** the server checked only that the token had not expired, then read the id and admin flag from the editable copy instead of asking PocketBase.
**What changed:** every API check now asks PocketBase who the token belongs to and uses that answer (remembered for 5 seconds per token, so a page's burst of requests costs one lookup). The sign-in gate no longer lets through any path ending in ".js", only Next's own files and the images in `public/`. The Discord "now playing" switch uses the same check. Files: `apps/web/lib/auth.ts`, `apps/web/proxy.ts`, `apps/web/app/api/discord/update/route.ts`.
**Compare:** before = `8c39a5b`, after = `36dce44`.
- Test: `cd apps/web && npx vitest run lib/auth.test.ts proxy.test.ts`
  - Before: `Tests  6 failed | 2 passed (8)`, e.g. `expected true to be false` (admin taken from the cookie), `expected 'boss' to be 'alice'` (id taken from the cookie).
  - After: all pass (8 + 2).
- Test: `node tests/access-control-ui.test.mjs` (throwaway PocketBase on 8089, app on 3051).
  - Before: `FAIL  W01a ... (status 200)`, `FAIL  W01b ... (status 200)`, `FAIL  W01c ... (status 404)`, `FAIL  W01d ... (status 401)`
  - After: `PASS  W01a (403)`, `PASS  W01b (403)`, `PASS  W01c (307)`, `PASS  W01d (307)`; `22/22 passed` with every W02/W03/W08 probe and everyday flow.
- Try it yourself: sign in on the sandbox as a member and as an admin; Home, Library and (for the admin) Admin all open as before.
**Left as is:** the page shell still shows your name, photo and theme from the cookie (display only; every admin screen's data and the Admin area itself are checked by the server). Request logs label a request with the cookie's id.
**Host needs:** the new web build (`update.sh`).
**Risk:** medium. Every API call now depends on one extra, cached PocketBase check; the full unit suite (2749 tests) and the flows above pass.
