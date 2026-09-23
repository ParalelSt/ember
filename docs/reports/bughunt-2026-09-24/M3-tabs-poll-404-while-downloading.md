# M3. Asking for a guitar tab could briefly say "nothing here" right after you asked

**What you'd notice:** Right after starting a tab generation for a YouTube song, the app's first poll could see "not found" instead of "still working", possibly showing a confusing state for a moment.

**Why it happened:** Starting a job downloads the song first, which can take a few seconds. The server only marked the job as "running" once the download finished, so a poll that landed during the download saw neither a finished tab nor a running job, only silence.

**What changed:** The job is now marked as claimed the moment it's asked for, before the download starts, so any poll during that window correctly sees "still working". Files: `apps/web/lib/tabGenerate.ts` (new pending tracking), `apps/web/app/api/tabs/generated/[trackId]/route.ts` (POST marks it before awaiting the download).

**Compare:** before = `aac2a4c`, after = `e87b7a1`.
- Test: `npx vitest run app/api/tabs/generated/tabs-generated-race.test.ts`: before, `expected 404 not to be 404`; after, the poll returns "running" and the test passes.
- Screenshots: not visual.
- Try it yourself: request a tab for a YouTube song that hasn't been downloaded yet and poll immediately; it should never show "not found" once a generation was asked for.

**Risk:** low, adds a small in-memory marker cleared right after the download step.
