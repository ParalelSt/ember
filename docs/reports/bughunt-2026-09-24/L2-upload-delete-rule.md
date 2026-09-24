# L2. Deleting your own upload through /pb directly left the files behind

**What you'd notice:** nothing through the app's own delete button — that already worked correctly. But a member who called PocketBase directly (not through the app) could delete their upload's row while leaving its audio file, and cover art, sitting on disk forever.

**Why it happened:** the `uploads` collection's delete rule let the uploader delete their own row (`uploader = @request.auth.id`). The app's own delete route already does the right thing (checks ownership, then removes the row AND the files with admin credentials), but PB's rule gave a second, direct path in that skipped the file cleanup entirely.

**What changed:** `deleteRule` is now `null` (server-only), same as `updateRule` already was. Existing installs get the rule rewritten at boot, the same way old installs got `updateRule` fixed. Files: `pocketbase/pb_hooks/ensure_uploads.pb.js`. `apps/web/app/api/uploads/[id]/route.ts` already used the admin client for the actual delete, so nothing there needed to change.

**Compare:** before = `af4266e`, after = `2516abb`.
- Test: `npx vitest run lib/pbUploadsRules.test.ts` (from `apps/web`): fails before (`deleteRule: null` and the boot rewrite line both missing), passes after: `Test Files 1 passed (1)`, `Tests 2 passed (2)`. Also proved against a real throwaway PocketBase on port 8089 (app 3051 unused, no web app needed): a member's direct DELETE against `/api/collections/uploads/records/<id>` returned `204` with the old rule and `403 Only admins can perform this action` after the fix.
- Screenshots: none, not visual.
- Try it yourself: upload a song, delete it from the app as normal — still works. The bug itself only reproduces via a direct PocketBase API call, not through the UI.
**Risk:** low, tightens a server-side rule; the app's own delete flow is unaffected.
