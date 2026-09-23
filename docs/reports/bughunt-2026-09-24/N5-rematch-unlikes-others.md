# N5. Fixing a transfer's match could unlike a song it never liked

**What you'd notice:** You fix a wrong match from a transfer ("Wrong song? Re-match"), and a song you already had in Liked songs, brought in by an earlier transfer, disappears from your likes.

**Why it happened:** To remove the wrong guess, Ember deleted any imported like of that song, without checking whether this transfer had actually made it. If the song was already liked before the transfer ran, or another song of the same transfer also matched it, the like still went.

**What changed:** Each transferred song now remembers the exact like it created. A re-match removes only that like; if another song of the same transfer still points at the same video, that song takes the like over instead. Songs from older transfers (before this field existed) never remove anything. The new field is added on start-up by the existing `ensure_imports` hook, no migration. Files: `apps/web/lib/import/store.ts`, `apps/web/lib/import/runner.ts`, `pocketbase/pb_hooks/ensure_imports.pb.js` (`import_items.like_id`).

**Compare:** before = `1be8ba2`, after = `31487fb`.
- Test: `cd apps/web && npx vitest run lib/import/runner.test.ts lib/import/store.test.ts`: fails before (6 failing), e.g.
  `a re-match leaves an import like this transfer did not make: expected [ 'alt0' ] to deeply equal [ 'alt0', 'vid0' ]`
  `saves on each item the like it made: expected undefined to be null`
  Passes after (55/55).
- Also checked: a throwaway PocketBase on port 8089 booted with the old hooks, then the new ones, logged `[ensure_imports] updated 1 import_items field(s)` once and nothing on the next boot.
- Screenshots: not visual.
- Try it yourself: on the sandbox, like a song, run a transfer that matches that same song, then Re-match it to another song. The first song stays liked.

**Risk:** low. The worst case for older transfers is a wrong guess that stays liked and has to be unliked by hand.
