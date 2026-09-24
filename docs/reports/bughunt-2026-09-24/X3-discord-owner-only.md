# X3. Other members wiped or took over the owner's Discord status

**What you'd notice:** your Discord profile (on the machine Ember runs on) shows a friend's song instead of yours, or goes blank whenever a friend who doesn't share presses pause. Even someone not signed in could blank it.

**Why it happened:** the server has one Discord card, yours, but it took "set" or "clear" from anyone: every member who shared set it, every member who didn't share cleared it, and the route was open to signed-out callers.

**What changed:** only your own account may set or clear the card: the `EMBER_ADMIN_EMAIL` account, or any admin if that isn't set. Other members' calls are ignored and signed-out calls get a 401 (the route left the public list). A signed-out visitor on a public song page no longer calls it. The desktop app is untouched: it talks to each person's own Discord directly. Files: `app/api/discord/update/route.ts`, `proxy.ts`, `lib/discordPresence.ts`, `tests/privacy.test.mjs` (C3/C4 updated).

**Compare:** before = `861197e`, after = `46998d6`.
- Test: `cd apps/web && npx vitest run app/api/discord/update/route.test.ts proxy.test.ts lib/discordPresence.test.ts`: fails before (7 failures), passes after (21 of 21).
  - `× ignores another member who doesn't share (no wipe)` / `expected "vi.fn()" to not be called at all, but actually been called 1 times`
  - `× answers the Discord presence route with 401 when there is no session` / `expected 200 to be 401`
  - `× does not call the server when signed out` / `expected "vi.fn()" to not be called at all, but actually been called 2 times`
- Try it yourself: on the host machine, sign in as the owner in a browser and play a song: the card shows it. Sign in as a second member elsewhere and play or pause: your card doesn't change.

**Risk:** low. If `EMBER_ADMIN_EMAIL` is set in `.env.local` to an address you don't sign in with, your card stays empty: check it matches your account.
