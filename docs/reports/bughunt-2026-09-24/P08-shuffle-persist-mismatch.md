# P08. Shuffle survived a reload, but the "unshuffle" button stopped working

**What you'd notice:** turn on shuffle, reload the app (or reopen it later), and shuffle still shows as on but tapping it to turn shuffle off does nothing to fix the order anymore.

**Why it happened:** the app saved the "shuffle is on" flag to your device, but never saved the original song order it needs to restore when you turn shuffle back off. After a reload, the flag came back but the order to restore was gone, so the off switch was disarmed.

**What changed:** the app now only remembers your queue, volume, and other settings across a reload, not the shuffle flag. Every fresh start now opens unshuffled, which matches what the code's own comment already promised. Files: `apps/web/stores/usePlayerStore.ts` (drop `shuffle` from the persisted fields), `apps/web/stores/usePlayerStore.test.ts` (new test).

**Compare:** before = `21bd7172266e25b6c0341923b7afe8c2c0c7006c`, after = `f5b0a6bba1bb015a047fe2dc71e4db38421f2080`.
- Test: `npx vitest run stores/usePlayerStore.test.ts -t "does not persist shuffle"`: before, fails with `expected {...} to not have property "shuffle"` (received `true`); after, all 8 tests in the file pass.
- Screenshots: not visual.
- Try it yourself: turn shuffle on, reload the page, shuffle should show off.

**Risk:** low. This only removes one field from what's saved; nothing else about shuffle's on-session behavior changes.
