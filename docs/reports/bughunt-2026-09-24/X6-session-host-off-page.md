# X6. Leaving a carlist page without "End" turned radio off for good

**What you'd notice:** you host a carlist, then go to another page (or close the tab) without pressing End. Guests' Skip buttons stop doing anything (their skips pile up and all fire later), their new songs never reach your queue, and radio never extends your queue again, even days later or after signing out.

**Why it happened:** the "I'm hosting" note was saved on the device, but only the session page ever cleared it, and the skip/new-song checks only ran while that page was open. Leave the page and the note stayed forever while nothing listened for guests.

**What changed:** the host's work (reading guest skips, adding their songs, saying what is playing) now runs from the app shell on every page while you host. The note is dropped when the session has ended, is gone or is not yours any more, and when you sign out. A network blip keeps it. Files: `hooks/useSessionHost.ts`, `components/session/SessionHostBridge.tsx`, `app/(app)/layout.tsx`, `app/(app)/session/[id]/page.tsx`, `components/providers/AuthProvider.tsx`.

**Compare:** before = `1780a04`, after = `a5d8930`.
- Test: `cd apps/web && npx vitest run hooks/useSessionHost.test.tsx components/providers/AuthProvider.session.test.tsx`: fails before (6 of 7), passes after (7 of 7).
  - `× runs guest skips while hosting` / `AssertionError: expected "vi.fn()" to be called with arguments: [ 's1' ]`
  - `× releases the hosting flag once the session has ended` / `AssertionError: expected 's1' to be null`
  - `× clears the carlist hosting flag` (sign-out) / `AssertionError: expected 's1' to be null`
- Try it yourself: on the sandbox, start a carlist on one account and join it with a second. Host: go to Home. Guest: tap Skip. The host's song now skips within about 3 s. Then host: open the session and press End; play a single song to the end of the queue and radio adds more again.

**Risk:** low. The session page and the shell share one poll, so there is no extra traffic while the page is open.
