# M4. A single stuck download logged as two failures

**What you'd notice:** Nothing user-facing; this is server log noise that made a single stuck yt-dlp call look like two separate failures.

**Why it happened:** When a call times out, the server force-kills the process and logs "timed out". The killed process still reports back that it exited, and the server logged that exit too, so one real timeout printed two error lines.

**What changed:** Once a timeout has been logged, the process's own exit report is ignored instead of logged again. Kept to just the logging path, since another change to this same function's concurrency is in flight elsewhere. Files: `apps/web/lib/sources/youtube.ts` (runPython).

**Compare:** before = `32055d9`, after = `289d0a0`.
- Test: `npx vitest run lib/sources/youtube-runpython-timeout.test.ts`: before, `expected ... to have a length of 1 but got 2`; after, exactly one log entry.
- Screenshots: not visual.
- Try it yourself: needs a real stuck yt-dlp call; covered by the unit test instead.

**Risk:** low, a single boolean guard local to one function.
