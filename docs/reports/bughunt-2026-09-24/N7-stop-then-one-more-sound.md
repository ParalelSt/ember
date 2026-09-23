# N7. Stop / Stop everything could be followed by one more sound

**What you'd notice:** You press Stop on a repeating sound (or Stop everything), and a few seconds later the person still gets one more sound.

**Why it happened:** Every 5 seconds the server looks for repeats that are due. If you pressed Stop just after it looked, it still went ahead with the list it had already read and sent the sound, after Stop had already cleared the waiting ones.

**What changed:** Right before sending, the server checks again that the repeat is still on. It also checks once more just after, and takes the sound back if Stop landed in between, so nothing slips through the gap. Files: `apps/web/lib/pranks/scheduler.ts`, `apps/web/lib/pranks/schedulerInstance.ts`.

**Compare:** before = `3459291`, after = `3d74b2b`.
- Test: `cd apps/web && npx vitest run lib/pranks/scheduler.test.ts`: fails before:
  `a Stop that lands after the schedule was read sends no sound: expected [ { target: 'marko', …(8) } ] to deeply equal []`
  `a Stop that lands while the row is being written takes it back: expected [ { target: 'marko', …(8) } ] to deeply equal []`
  Passes after (21/21).
- Screenshots: not visual.
- Try it yourself: hard to hit by hand (the gap is a fraction of a second every 5 s); covered by the tests. Only ever on sandbox test accounts, never a real one.

**Risk:** low. Two extra small reads per repeat that fires; nothing changes for a repeat that is still on.
