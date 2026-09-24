# X1. An invited email that hasn't signed up yet can be claimed by someone else
**Status:** partly fixed (needs owner decision).
**What you'd notice:** nothing, until an invited friend tries to sign up and is told the account already exists, because a stranger created it first with their email and a password of the stranger's choosing.
**Why it happened:** signing up only checks that the email is on the invite list. Nothing checks that the person signing up owns that inbox. The sign-in page also answered, without limit, whether an email is invited and still unclaimed, and the first invites are written in plain text in the repo's migrations, which are public.
**What changed now (the safe part):** the invite check on the sign-in page is limited to 10 per caller per 10 minutes, so the list can't be probed at speed. Normal sign-in uses one or two. The sign-up flow itself is unchanged. Files: `apps/web/app/api/auth/check-email/route.ts`.
**What still needs your call:** someone who already knows an invited, unclaimed email can still take it. Pick one:
- **A. Email verification.** New accounts get a confirmation email and only work after the link is clicked. Proves the inbox is theirs. Needs mail (SMTP) settings on the host, e.g. a free Resend or Gmail app-password account, and one extra step for friends.
- **B. Invite links.** Instead of adding an email, Admin > Users makes a one-time link you send to the friend yourself; only that link can sign up. No mail setup; changes how you invite people.
- **C. Keep the list, tidy it.** Remove invites nobody is going to use, and invite people only right before they sign up. No code, smallest gap.
- Either way: check Admin > Users now that every account is someone you know, and consider making the GitHub repo private (the old invite emails are in its history).
**Compare:** before = `89a4519`, after = `18a5a27`.
- Test: `cd apps/web && npx vitest run app/api/auth/check-email/route.test.ts`
  - Before: `Tests  2 failed | 1 passed (3)`: `expected 0 to be greater than 0` (no check was ever refused).
  - After: 3 passed (the 11th check in 10 minutes gets 429 with Retry-After; another caller is unaffected).
- Test: `node tests/access-control-2-ui.test.mjs`: before `FAIL X1 one caller cannot check emails without limit (40 answered, 0 refused)`; after `PASS X1 ... (9 answered, 31 refused)` and `PASS F12 the sign-in page can still check an email`.
- Try it yourself: on the sandbox, sign out and sign in normally. It works as before.
**Host needs:** the new web build (`update.sh`). Tests that sign in through the form many times in a row against one app may now meet the limit; restarting the app resets it.
**Risk:** low. A household behind one address signing in more than 10 times in 10 minutes would be asked to wait a few minutes.
