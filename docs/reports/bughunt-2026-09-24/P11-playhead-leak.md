# P11. The previous song's time could stick to the next song
**What you'd notice:** after one song played to, say, 2:30 and the next one started, pausing or leaving the app in the first moments of the new song could save 2:30 as its spot. Reopening the app then resumed the new song at 2:30.
**Why it happened:** the player keeps a "last good time" to fall back on while a new song is still settling. It was never cleared when a song changed, so it still held the old song's time.
**What changed:** that fallback is now reset to the new song's own start point whenever a song is loaded. Files: `apps/web/hooks/player/usePositionPersistence.ts`.
**Compare:** before = `918a303`, after = `b724287`.
- Test: `cd apps/web && npx vitest run hooks/player/usePositionPersistence.test.ts`: fails before, passes after.
  - `does not let the previous song's playhead leak into the next one`: `expected 150 to be +0`
  - `a resumed track falls back to where it resumed`: `expected 150 to be 42`
  - After: 20 of 20 pass; full unit suite 2692/2692.
- Screenshots: none (the wrong time only shows after a reload, timing-dependent).
- Try it yourself: play a song past 2:00, press next, pause within the first half second, reload the page. The new song should sit at 0:00, not at the old song's time.
**Risk:** low. One line, only changes the fallback value at the moment a song loads.
