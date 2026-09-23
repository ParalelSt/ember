# M2. A stuck tab generation left junk folders on the server

**What you'd notice:** Nothing in the app itself, but if a guitar-tab generation hung and timed out, the server quietly kept a temporary audio folder around forever.

**Why it happened:** When a transcription runs too long we force-kill it. The Python script normally cleans up its own temp folder when it finishes, but a force-kill gives it no chance to do that, so the folder was left behind every time this happened.

**What changed:** The server now sweeps away any leftover `ember-transcribe-*` folders itself whenever a transcription job ends, kill or crash included. Files: `apps/web/lib/tabGenerate.ts` (runScript's timeout/error/close handlers).

**Compare:** before = `1a2e659`, after = `70836d2`.
- Test: `npx vitest run lib/tabGenerate.test.ts`: before, the new leak test hung and timed out (no cleanup ever ran); after, both tests pass.
- Screenshots: not visual.
- Try it yourself: needs a real stuck transcription; covered by the unit test instead.

**Risk:** low, the sweep only ever deletes folders matching the `ember-transcribe-` prefix under the OS temp dir.
