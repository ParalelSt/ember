# V2. A sign-in link could send you to another website afterwards
**Status:** fixed.
**What you'd notice:** nothing in normal use. The risk: someone could send you a real Ember sign-in link like `/auth?next=/%5Cexample.com`; after you signed in, Ember forwarded you to example.com, which could pose as Ember and ask for your password again.
**Why it happened:** the sign-in page only checked that the "go back to" address started with one slash. Browsers treat a backslash as a slash and silently drop tabs, so `/\example.com` or `/<tab>/example.com` is really `//example.com`, another website.
**What changed:** the "go back to" address now has to turn out to be a page on this same site once the browser has read it; addresses with backslashes or hidden characters, `//` links and full `https://` links all go to Home instead. Files: `apps/web/lib/safeNext.ts` (new), `apps/web/app/auth/page.tsx`.
**Compare:** before = `881c636`, after = `c8d6055`.
- Test: `cd apps/web && npx vitest run app/auth/page.test.tsx lib/safeNext.test.ts`: fails before (`expected '/\example.com' to be '/'`, `expected '/\t/example.com' to be '/'`, and `lib/safeNext.test.ts` has nothing to load), passes after (`Tests 13 passed`). Covers backslash, two backslashes, `//`, `%2F%2F`, `///`, tab and newline, `https://`, `https:example.com`, `javascript:`, and a look-alike `ember.example.evil.com`.
- Browser: real sign-in on a throwaway build (app 3055, PocketBase 8084) with `next=` set to `/%5Cexample.com`, `//example.com`, `%2F%2Fexample.com`, `https://example.com`, `/%09/example.com`: every one lands on `http://127.0.0.1:3055/`; `next=%2Flibrary` still lands on `/library`.
- Screenshots: none, not visual.
- Try it yourself: sign out on the sandbox, open `/auth?next=/%5Cexample.com`, sign in: you land on Home, not example.com.
**Risk:** low. Only the post-sign-in destination changes, and only for addresses that were never Ember pages.
