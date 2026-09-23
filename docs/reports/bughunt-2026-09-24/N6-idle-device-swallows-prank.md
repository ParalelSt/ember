# N6. An idle second device could swallow a sound prank

**What you'd notice:** You send a sound to someone who is listening on their phone, but they also have Ember open (not playing) in a laptop tab. The log says "not played: nothing was playing" and they never hear it.

**Why it happened:** Every open Ember checks for pranks. Whichever device checked first answered for all of them: an idle tab answered "nothing is playing here", the server marked the prank as skipped, and the phone that was actually playing never saw it.

**What changed:** A device where nothing is playing now stays silent: it neither plays the sound nor answers, and leaves the prank waiting. The device that is playing picks it up on its next check; if the idle one starts playing within the 45 s window, it can take it itself. If no device plays it, it simply expires (the log already says "not delivered: offline, paused, or app too old"). Unchanged, as you chose: sounds only while music plays, no opt-out, and the person is never told. Files: `apps/web/lib/pranks/decide.ts`, `apps/web/hooks/pranks/usePrankInbox.ts`, `apps/web/components/player/PrankReceiver.tsx`, `docs/pranks.md`.

**Compare:** before = `4235144`, after = `ae9d311`.
- Test: `cd apps/web && npx vitest run lib/pranks/decide.test.ts components/player/PrankReceiver.test.tsx hooks/pranks/usePrankInbox.test.ts`: fails before (5 failing), e.g.
  `an idle second device never swallows the sound meant for the one playing: expected "vi.fn()" to not be called at all, but actually been called 1 times`
  `a device where nothing plays leaves the sound for one that does: expected { type: 'skip', reason: 'not-playing' } to deeply equal { type: 'wait' }`
  Passes after (37/37).
- Screenshots: not visual (nothing is ever shown to the person).
- Try it yourself: needs two sandbox test accounts on two browsers or devices: the target plays music in one and leaves the other open and paused, then an admin sends a sound. Never try it on a real account.

**Risk:** low. The only change in the log: a prank nobody could hear now reads "not delivered" instead of "nothing was playing".
