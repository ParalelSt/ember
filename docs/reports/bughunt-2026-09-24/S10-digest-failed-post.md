# S10. A failed daily digest was never sent that day

**What you'd notice:** some mornings the daily error digest simply didn't arrive in Discord, with no retry, if Discord or the network had a hiccup right when it went out.

**Why it happened:** after trying to post, the digest wrote its "done for today" note whether the post worked or not. That was there to stop it retrying every minute, but it also meant one failed post lost the whole day's digest.

**What changed:** a failed scheduled post no longer marks the day done. It is tried again after at least 30 minutes, at most 3 tries a day; after the third failure the day is marked done, so a broken webhook can never flood Discord. While it waits, the minute-by-minute check skips straight out without reading the logs or calling the AI summary. The small "failed today" note is cleaned up by the same old-log sweep as the other log files. Files: `apps/web/lib/reports/digestJob.ts` (runDigest), `apps/web/lib/logger/server.ts` (sweep pattern), `apps/web/lib/reports/digestJob.test.ts`.

**Compare:** before = `1e7bb43f3f2e2be579a65ac266fa5453c049db99`, after = `439e4f9ce0922e3b0fbebbd47f0efec6390a66ef`.
- Test: `cd apps/web && npx vitest run lib/reports/digestJob.test.ts`: before, `does not mark the day sent when the post failed, and retries it later` fails (`expected true to be false`: the day was marked sent after the failed post); after, all 22 pass, including `gives up for the day after 3 failed posts` (exactly 3 post attempts, then marked done). The tests use a fake webhook address and a mocked fetch: nothing reaches the real Discord.
- Screenshots: not visual.
- Try it yourself: not safe on the sandbox, since the digest posts to the real Discord channel. The tests above simulate it.

**Risk:** low. A successful or quiet day behaves exactly as before; the manual admin trigger never writes either note and is unaffected. Worst case is 3 digest posts in a day if Discord accepts a post but reports it as failed.
