# P12. Seeking right after a song starts jumped back to 0:00
**What you'd notice:** tapping or dragging the progress bar (or seeking from the lock screen) in the first moment after a song started sent it back to 0:00 instead of to the spot you picked.
**Why it happened:** the browser does not know a song's length until the first bit of it has loaded. The player capped every seek at "the length", and an unknown length counted as zero, so the cap was 0:00. The bar itself did the same when it had no length at all.
**What changed:** the player only caps a seek when it really knows the length, and the bar is greyed out (and never seeks) while the length is unknown. Files: `apps/web/lib/playback/webBackend.ts`, `apps/web/components/player/SeekBar.tsx`.
**Compare:** before = `adb1679`, after = `6be6f49`.
- Test: `cd apps/web && npx vitest run components/player/SeekBar.test.tsx lib/playback/webBackend.test.ts`: fails before, passes after.
  - `seeks to the asked time while the element does not know the length yet`: `expected last "vi.fn()" call to have been called with [ 90 ]`
  - `sits at zero, disabled, without a duration, and never seeks to 0:00`: `expect(element).toBeDisabled()` failed
  - After: 10 of 10 pass; full unit suite 2694/2694.
- Screenshots: none. The greyed bar only shows in the rare moment a song has no known length; the jump itself is a timing effect the test measures directly.
- Try it yourself: start a song and immediately click near the end of the progress bar. It should jump there, not back to 0:00.
**Risk:** low. The desktop engine already worked this way; known lengths are still capped as before.
