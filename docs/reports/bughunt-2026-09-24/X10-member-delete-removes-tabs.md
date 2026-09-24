# X10. Deleting a member deleted the tabs they shared, and left the files on disk
**Status:** fixed.
**What you'd notice:** after deleting a member in Admin > Users, every tab they had added disappeared for everyone, while the tab files stayed on the server's disk with nothing pointing at them.
**Why it happened:** each tab row was tied to its uploader with "delete along with the member". PocketBase removed the rows, but only the app knows to remove the files, and it was never asked. The uploader could also delete their tab row straight through PocketBase, which left the file the same way.
**What changed:** a shared tab now stays when its uploader is deleted, just no longer naming them. Their private tabs (which nobody else could open) are removed with their files by the admin delete. Tab rows can only be deleted through the app, which always removes the files too. Existing servers switch the next time PocketBase starts. Files: `pocketbase/pb_hooks/ensure_tabs.pb.js`, `apps/web/lib/tabStore.ts` (`deletePrivateTabs`), `apps/web/app/api/admin/users/[id]/route.ts`.
**Compare:** before = `05d0d8f`, after = `fc6a709`.
- Test: `node tests/access-control-2-ui.test.mjs` (throwaway PocketBase on 8084, app on 3055; env in `tests/README.md`).
  - Before: `FAIL X10a a tab row cannot be deleted around the app (its file would stay) (status 204)`, `FAIL X10b deleting a member keeps the tabs they shared (delete 200, row gone)`, `FAIL X10d their private tab goes with them, file and all (row gone, file left on disk)`.
  - After: all four X10 checks pass (`status 403`, `row kept`, `row gone, file gone`), with `PASS F10 the uploader deletes their tab in the app, file and all`.
- Test: `cd apps/web && npx vitest run lib/tabStore.test.ts`: the new "deleting a member" case passes (27 tests).
- Try it yourself: on the sandbox, add a tab with a second account, then delete that account as admin. The tab still opens for everyone else.
**Host needs:** a PocketBase restart and the new web build (`update.sh` does both).
**Risk:** low. Deleting your own tab in the app works as before; only the direct PocketBase delete is gone.
