# S11. Old server logs and digest markers only got cleaned up once, at startup

**What you'd notice:** nothing user-facing, but on a host that stays up for more than a couple of days, the `logs/` folder would slowly grow one file a day forever instead of the old ones being deleted.

**Why it happened:** the cleanup that deletes error logs and digest markers older than the retention window only ran the very first time the server touched the log files after starting. On a long-lived process that never restarts, "the first time" only ever happens once, so nothing past that point ever got swept again, even as new days rolled by.

**What changed:** the sweep now remembers which calendar day (UTC) it last ran for, and re-runs itself the next time a log is written or read after the day has changed, not just once at boot. Files: `apps/web/lib/logger/server.ts` (day-keyed sweep guard), `apps/web/lib/logger/server.test.ts` (1 new test).

**Compare:** before = `bd8af97`, after = `16a4517`.
- Test: `cd apps/web && npx vitest run lib/logger/server.test.ts`: before, `re-sweeps when the day rolls over, not just once at boot (bughunt S11)` fails with `AssertionError: expected true to be false` (a file that aged past retention after the day rolled over was still on disk); after, all 9 pass.
- Screenshots: not visual.
- Try it yourself: needs a server left running across a real day boundary, which can't be triggered on demand.

**Risk:** low. Same sweep logic and retention window as before; this only changes how often it's allowed to run.
