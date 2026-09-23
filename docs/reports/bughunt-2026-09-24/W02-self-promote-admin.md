# W02. Members could make themselves admin
**Status:** fixed.
**What you'd notice:** nothing in normal use. The risk: any invited member (or anyone on the invite list signing up) could quietly give themselves the admin role, and with it Admin > Users, invites, track editing and cleanup.
**Why it happened:** members are allowed to save their own account (name, photo, theme). The database treated "admin" as just another field on that account, so it let them save that too, and sign-up did not check it either.
**What changed:** a small PocketBase rule now refuses any change to the admin flag unless it comes from the server's admin login (which is what Admin > Users uses). Normal profile edits and sign-ups are untouched. Files: `pocketbase/pb_hooks/guard_is_admin.pb.js` (new), `tests/access-control-ui.test.mjs` (new).
**Compare:** before = `9d0dad2`, after = `9e57774`.
- Test: `node tests/access-control-ui.test.mjs` (throwaway PocketBase on 8089 with this branch's hooks, app on 3051).
  - Before: `FAIL  W02a a member cannot make themselves admin  (status 200)` and `FAIL  W02b a new invitee cannot sign up as admin  (status 200)`
  - After: `PASS  W02a ... (status 403)`, `PASS  W02b ... (status 403)`, and still `PASS  F5 profile edit (name)`, `PASS  F8 an admin makes someone an admin`, `PASS  F9 an invitee signs up`.
- Try it yourself: on the sandbox, change your name in Settings (still works); in Admin > Users, make someone an admin (still works).
**Host needs:** a PocketBase restart so the new hook loads (`update.sh` already restarts it).
**Risk:** low. The only thing now refused is changing the admin flag without admin credentials.
