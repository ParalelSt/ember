# P01. Every song change loaded the song twice
**What you'd notice:** on every play, next, previous and auto-advance the player blinked paused then playing, the phone notification did the same, and on desktop a song that failed showed two "Couldn't load" toasts. It is the likely cause of the lock-screen controls disappearing when a song auto-advances.
**Why it happened:** the button handler loaded the new song, and then a "the song changed" watcher loaded the very same song again a moment later, cutting off the first start. The web player also treated that cut-off as if you had pressed pause.
**What changed:** the watcher now skips a song that is already loaded, and a start that was cut off by a newer load is no longer reported as a pause. Replaying the current song, loop-one, and resuming after a reload still work as before. Files: `apps/web/components/player/PlayerProvider.tsx`, `apps/web/lib/playback/webBackend.ts`.
**Compare:** before = `405ab61`, after = `f354c21`.
- Test: `cd apps/web && npx vitest run components/player/PlayerProvider.doubleload.test.tsx lib/playback/webBackend.test.ts`: fails before, passes after.
  - `AssertionError: expected [ '/s/b', '/s/b' ] to deeply equal [ '/s/b' ]` (next, prev, auto-advance, play; web and desktop: 8 of 15 fail)
  - `does not report a pause when play() was aborted by a newer load`: `expected "vi.fn()" to not be called at all, but actually been called 1 times`
  - After: 17 of 17 pass; full unit suite 2690/2690.
- Screenshots: none (the flicker lasts a fraction of a second; the test counts the loads instead).
- Try it yourself: on a phone, play an album, lock the screen and let a song end. The controls should stay and not blink. Needs a real phone for the lock-screen part.
**Risk:** medium. It touches the core load path; covered by tests for web, desktop and Android, including the reloads that must still happen.
