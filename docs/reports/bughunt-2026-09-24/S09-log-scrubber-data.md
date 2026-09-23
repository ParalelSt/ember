# S09. Bug reports lost the details of server errors

**What you'd notice:** in a bug report or the daily digest, a server error's extra details (which route, which status, which arguments) often showed up as just `[object Object]`.

**Why it happened:** before a server log entry leaves the host, its details are checked for secrets. The checker turned the whole details object into one long line of text, cleaned it, and turned it back. One of the cleaning rules (hide what someone typed after `?q=`) also ate the closing quote of the text, so turning it back failed and the fallback threw all the details away.

**What changed:** the checker now goes through the details piece by piece and cleans each piece of text on its own, so the object always survives. Every existing rule still runs on every piece, and anything stored under a secret-sounding name (cookie, authorization, token, the Google sign-in fields, the Google header names) is replaced as a whole. Files: `apps/web/lib/logger/sanitize.ts` (scrubServerEntry, new `scrubDataLeaves`), `apps/web/lib/logger/sanitize.test.ts` (4 new tests).

**Compare:** before = `56818c54fa00518ac1ee212488903f596b39a9a9`, after = `94c1de68db263af923a52b5664d89a7174d09ac5`.
- Test: `cd apps/web && npx vitest run lib/logger/sanitize.test.ts`: before, 2 fail (`expected '[object Object]' to deeply equal { …(3) }`); after, all 13 pass, including one that feeds cookies, bearer tokens, Google tokens, pb_auth, a long hex blob and a `?token=` URL and checks none survive.
- Also rerun: `lib/import/redact.test.ts`, `app/api/bug-report/route.test.ts`, `lib/reports/digestJob.test.ts` (the other secret tests): 81 of 81 pass.
- Screenshots: not visual.
- Try it yourself: the next real bug report or daily digest that includes a server error shows its details instead of `[object Object]`. Not triggered from the sandbox, since reports post to the real Discord.

**Risk:** low. Secrets are dropped at least as thoroughly as before (a value under a secret-sounding name is now dropped outright), and ordinary details are kept instead of lost.
