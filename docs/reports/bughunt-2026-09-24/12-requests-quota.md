# 12. Feature/fix requests used up your quota even when they failed

**What you'd notice:** if a feature or fix request bounced (a typo the form should have caught, or Discord hiccuping), it still counted against the 5-per-hour limit, so a few failed tries locked you out for the rest of the hour with nothing sent.

**Why it happened:** the server checked and used up one of your 5 tries before it even looked at whether the request was valid or whether Discord accepted it.

**What changed:** the quota is now only spent once Discord actually accepts the message. A bad request or a Discord failure no longer costs you a try. Files: `apps/web/app/api/requests/route.ts` (charge on success only), `apps/web/lib/rateLimit.ts` (new non-consuming check + `recordRateLimitHit`).

**Compare:** before = `9d0dad2`, after = `ff2905a`.
- Test: `npx vitest run app/api/requests/route.test.ts lib/rateLimit.test.ts`: new cases `[bughunt W12] charges the quota once Discord accepts...` and `does not charge the quota when Discord rejects...` fail before (mock for `recordRateLimitHit` doesn't exist / the hit is recorded up front regardless of outcome), pass after: `Test Files 2 passed (2)`, `Tests 38 passed (38)`.
- Screenshots: none, not visual.
- Try it yourself: submit an invalid feature request (empty name) five times in a row, then a valid one — it should still go through.
**Risk:** low, only touches when the counter increments, not the limit itself.
