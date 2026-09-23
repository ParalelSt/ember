# 06. Transfer previews used up your 5-per-hour import limit

**What you'd notice:** while typing or pasting a list into the Transfer dialog, just looking at the preview (before pressing Import) could use up your 5 tries for the hour, so by the time you actually wanted to start the transfer you were locked out.

**Why it happened:** the server checked the hourly limit before it knew whether the request was a preview (just showing you what's in the file) or a real transfer start, so every pause while typing counted as a try.

**What changed:** the hourly limit is now only checked, and only spent, for a real transfer start. Previews are free, however many you look at. Files: `apps/web/app/api/import/upload/route.ts` (rate-limit check moved after the preview branch).

**Compare:** before = `9d0dad2`, after = `211db65`.
- Test: `npx vitest run app/api/import/upload/route.test.ts`: new cases `[bughunt W06] never touches the hourly import-start limit` and `many previews in a row still leave a real start free` fail before (20 previews consumed 20 hourly hits: `rateLimitKeys` had 20 entries instead of `[]`), pass after: `Test Files 1 passed (1)`, `Tests 16 passed (16)`.
- Screenshots: none, not visual.
- Try it yourself: open Transfer, paste a long list, pause a few times while editing it (each pause re-runs the preview), then press Import — it should still go through.
**Risk:** low, only moves when the check runs, not what it checks.
