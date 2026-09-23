# W08. An uploader could point their upload at someone else's file
**Status:** fixed.
**What you'd notice:** nothing in normal use. The risk: a member who uploaded a song could change which file on the server their upload pointed to. Deleting their own upload afterwards would then delete another member's song file, leaving that song broken for everyone.
**Why it happened:** the database let an uploader edit every field of their own upload, including the stored file name that the delete button later removes from disk. The app itself never needed that permission.
**What changed:** uploads can now only be changed by the server. The uploader can still upload, play and delete their own songs through the app. Existing servers get the new rule the next time PocketBase starts. Files: `pocketbase/pb_hooks/ensure_uploads.pb.js`.
**Compare:** before = `945cfc4`, after = `27ce081`.
- Test: `node tests/access-control-ui.test.mjs` (throwaway PocketBase on 8089, app on 3051).
  - Before: `FAIL  W08 an uploader cannot change the stored filename  (status 200)`
  - After: `PASS  W08 an uploader cannot change the stored filename  (status 403)`, with `PASS  F6 upload a song` and `PASS  F6b play the upload`.
- Try it yourself: upload a song on the sandbox, play it, delete it. All three still work.
**Host needs:** a PocketBase restart (`update.sh` does it).
**Risk:** low. Nothing in the app edited uploads directly.
