# X7. A quick double tap on the heart left the song liked
**Status:** fixed.
**What you'd notice:** tapping the heart twice quickly (like, then undo) showed the song as not liked, but a moment later, or on the next visit, it was back in Liked Songs.
**Why it happened:** both taps were sent to the server at the same time. The "unlike" could arrive first, find nothing to remove yet, and then the "like" landed.
**What changed:** the app now sends like and unlike for the same song one after the other: the second tap waits until the first is done. The heart still changes instantly, and no longer flashes back while the taps go through. The server already treated a repeated like or unlike as harmless, so it needed no change. Files: `apps/web/hooks/useLibrary.ts`.
**Compare:** before = `8bbbe1e`, after = `630eb5b`.
- Test: `cd apps/web && npx vitest run hooks/useLikeToggle.test.tsx`
  - Before: `× a quick double tap waits for the like before sending the unlike`: `expected "vi.fn()" to not be called at all, but actually been called 1 times` (the unlike went out while the like was still on its way).
  - After: 6 passed; the unlike goes out only after the like finishes, the heart never flips back, and the song ends up not liked.
- Test: `node tests/access-control-2-ui.test.mjs`: `PASS X7a liking twice leaves one like`, `PASS X7b unliking twice is fine and leaves it unliked` (before and after: the server side was already safe).
- Try it yourself: on the sandbox, double tap the heart on a song you haven't liked, then reload Liked Songs. The song is not there.
**Host needs:** the new web build (`update.sh`).
**Risk:** low. Only the order of like requests changed.
