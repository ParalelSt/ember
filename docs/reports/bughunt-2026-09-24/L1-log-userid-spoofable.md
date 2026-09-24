# L1. A member could make their errors show up under someone else's name in logs

**What you'd notice:** nothing on screen. In the server logs and bug reports, a request's `userId` could be wrong: a member who edited their own browser cookie could make their errors get attributed to a different member.

**Why it happened:** the request logger read the user id out of the `pb_auth` cookie's JSON copy of the user record, which the browser can edit freely. Only the signed token in that cookie is trustworthy; the id has to come from PocketBase's own answer to that token, the same way the real login check (`requireUser()`) already does it.

**What changed:** the logger now calls the same verified, cached lookup `requireUser()` uses instead of trusting the cookie's copy. Files: `apps/web/lib/logger/withRequestLog.ts`.

**Compare:** before = `912c7e8`, after = `f94f8d0`.
- Test: `npx vitest run lib/logger/withRequestLog.test.ts` (from `apps/web`): new case "logs the token-verified id even when the cookie copy claims a different one" fails before (`userId: 'forged-other-user-id'` instead of `'real-verified-user-id'`), passes after: `Test Files 1 passed (1)`, `Tests 101 passed (101)`.
- Screenshots: none, not visual.
- Try it yourself: needs devtools cookie editing plus a server log tail to see; not visible from the UI.
**Risk:** low, logging/triage only — no access control changed.
