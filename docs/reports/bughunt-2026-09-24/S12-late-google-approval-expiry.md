# S12. A slow "Allow" on Google's page could kill a likes transfer mid-read

**What you'd notice:** if someone took nearly the full 15 minutes to approve the Google sign-in, their transfer could fail right after approving, with no clear reason why.

**Why it happened:** the 15-minute clock started the moment the sign-in began (while waiting for "Allow"). If the approval came in close to that limit, the old clock kept running into the next step (reading the person's likes from Google) instead of being reset, so it could run out while the likes were still being fetched.

**What changed:** the moment the sign-in switches from waiting for approval to reading likes, it gets its own fresh 15 minutes, the same way the later "checking which likes are songs" step and the final "ready to import" step already do. Files: `apps/web/lib/import/google/flows.ts` (poll(), one `expireIn` call), `apps/web/lib/import/google/flows.test.ts` (1 new test).

**Compare:** before = `604034d`, after = `bebdf24`.
- Test: `cd apps/web && npx vitest run lib/import/google/flows.test.ts`: before, `a late approval gets a fresh deadline for reading, not the tail of the waiting one (bughunt S12)` fails with `AssertionError: expected 'expired' to be 'reading'`; after, all 28 pass.
- Screenshots: not visual.
- Try it yourself: needs someone to leave the Google approval page open for close to 15 minutes before approving, which can't be triggered on demand.

**Risk:** low. The reading step already reset this same clock again later (once likes start coming back); this just closes the gap right at the start of reading.
