# W03. Any member could rewrite the shared song catalog
**Status:** fixed.
**What you'd notice:** nothing in normal use. The risk: every member shares one list of song details (title, artist, artwork). Any signed-in member could rename or change any song there, and it would change for everyone, in every playlist and in Liked Songs.
**Why it happened:** the app saved song details with the member's own login when they liked, played or added a song, so the database had to let every member write that shared list, and it let them write any row, not just new ones.
**What changed:** only the server can now create or change catalog rows. Liking, playing, adding to a playlist, re-matching, session queues and recent searches save the song through the server's own login (signed in once and reused, so plays don't get slower). The admin track editor, imports and "song unavailable" marking already used it. Files: `pocketbase/pb_hooks/ensure_tracks_rules.pb.js` (new), `apps/web/lib/upsertTrack.ts`, `apps/web/lib/pocketbase/server.ts`, six member routes under `apps/web/app/api/`.
**Compare:** before = `58b694f`, after = `2690234`.
- Test: `cd apps/web && npx vitest run app/api/catalog-writes.test.ts lib/upsertTrack.test.ts`
  - Before: `Tests  6 failed (6)`: each route wrote the catalog with the member's own login.
  - After: all pass (9 tests).
- Test: `node tests/access-control-ui.test.mjs` (throwaway PocketBase on 8089, app on 3051).
  - Before: `FAIL  W03a a member cannot rename a song for everyone  (status 200)`, `FAIL  W03b ... (status 200)`
  - After: `PASS  W03a ... (status 403)`, `PASS  W03b ... (status 403)`, with like, play (including filling in missing artwork), playlist add, recent search and the admin track edit all still passing.
- Try it yourself: on the sandbox, like a song, play it, add it to a playlist; then as admin, edit that song's title in Admin > Tracks.
**Still possible, by design:** a member adding a song the server has never seen still supplies its first details (as before). They can no longer change a song once it exists.
**Host needs:** a PocketBase restart and the new web build (`update.sh` does both).
**Risk:** medium. It touches the like/play/add path; covered by the checks above.
