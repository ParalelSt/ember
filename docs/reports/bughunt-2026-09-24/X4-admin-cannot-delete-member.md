# X4. Admin couldn't delete a member who had added a carlist song or uploaded one
**Status:** fixed.
**What you'd notice:** in Admin > Users, deleting such a member failed with "Failed to delete record. Make sure that the record is not part of a required relation reference." and the member stayed.
**Why it happened:** a song someone uploaded, a song they queued in a carlist and a skip they pressed each had to name a member. PocketBase refuses to delete a member whom such a row still has to name.
**What changed:** those links are optional now. Deleting the member keeps their uploads (other people's playlists point at them) and carlist songs, and simply stops naming them. Carlists they hosted go with them, as before. Existing servers switch the next time PocketBase starts. Files: `pocketbase/pb_hooks/ensure_sessions.pb.js`, `pocketbase/pb_hooks/ensure_uploads.pb.js`. The admin delete route needed no change.
**Compare:** before = `e05edb8`, after = `367cfd7`.
- Test: `node tests/access-control-2-ui.test.mjs` (throwaway PocketBase on 8084, app on 3055; env in `tests/README.md`).
  - Before: `FAIL X4a an admin can delete a member who added a carlist song and uploaded one (status 400 {"error":"Failed to delete record. Make sure that the record is not part of a required relation reference."})`
  - After: `PASS X4a ... (status 200)`, `PASS X4b their upload stays for everyone (uploader "")`, `PASS X4c the carlist keeps working, their song still queued`, `PASS X4d their upload still plays`, `PASS F9 an admin deletes a member with no history`.
- Try it yourself: on the sandbox, with a second account upload a song and add a song to a carlist; then as admin delete that account in Admin > Users. The upload still plays.
**Host needs:** a PocketBase restart (`update.sh` does it).
**Risk:** low. Only which links must be filled in changed; an upload with no uploader can still be deleted by an admin.
