# X2. Any member could get into any carlist without the code
**Status:** fixed.
**What you'd notice:** nothing in normal use. The risk: any signed-in member could see every carlist's join code, put themselves on a carlist's roster, skip the host's song or add songs, all without being given the code.
**Why it happened:** the carlist data in PocketBase let every signed-in member read it all and write to it. The app's own carlist pages checked membership, but PocketBase is reachable directly through the app's `/pb` address, and there those checks did not apply.
**What changed:** members can no longer write any carlist data themselves. The app's carlist routes check host or membership and then write with the server's own login. Only the host and people who joined can read a carlist, so join codes are no longer listable. Existing servers get the new rules the next time PocketBase starts. This also fixes a smaller bug: on a brand-new server the roster was not created until the second start. Files: `pocketbase/pb_hooks/ensure_sessions.pb.js` (now also creates the roster; `ensure_session_members.pb.js` removed), `apps/web/lib/sessions.ts`, the routes under `apps/web/app/api/sessions/`.
**Compare:** before = `1780a04`, after = `19ac8b8`.
- Test: `cd apps/web && npx vitest run app/api/sessions/session-writes.test.ts`
  - Before: `Tests  4 failed | 1 passed (5)` (each route wrote carlist rows with the member's own login, so under the new rules it got 404).
  - After: `5 passed`.
- Test: `node tests/access-control-2-ui.test.mjs` (throwaway PocketBase on 8084, app on 3055; env in `tests/README.md`).
  - Before: `FAIL X2a a non-member cannot list join codes (status 200, code visible)`, `FAIL X2c ... (pb 200, then skip 201)`, `FAIL X2d ... skip the host's song (status 200)`, X2b, X2e to X2h failed too.
  - After: all 8 X2 checks pass (403/404), and the carlist flow still passes: `F1` start, `F2` join with the code, `F3` add songs, `F5` skip reaches the host, `F6` now playing, `F7` keep as playlist, `F11` end, plus `F4b` a member can still read their own carlist.
- Try it yourself: on the sandbox, start a carlist, join it from a second account with the code, add a song, skip, keep as a playlist, end it.
**Host needs:** a PocketBase restart and the new web build (`update.sh` does both).
**Risk:** medium. Every carlist route changed which login it uses; the whole carlist flow is covered by the checks above.
