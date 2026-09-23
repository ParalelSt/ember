# 13. Raw database errors instead of plain messages

**What you'd notice:** naming a playlist something very long (over 200 characters) showed a raw technical error instead of a normal "too long" message. Sending your profile update the wrong way (a rare client bug) crashed the request with a server error page instead of a clean failure.

**Why it happened:** the playlist route never checked the name's length before handing it to the database, which has its own limit and complains in its own words. The profile route assumed every request would be a normal form and didn't handle the case where it wasn't.

**What changed:** playlist names over 200 characters now get a plain "name must be at most 200 characters" message. A profile update sent the wrong way now gets a plain 400 instead of crashing. Files: `apps/web/app/api/playlists/route.ts`, `apps/web/app/api/profile/route.ts`.

**Compare:** before = `9d0dad2`, after = `a1139a3`.
- Test: `npx vitest run app/api/playlists/route.test.ts app/api/profile/route.test.ts`: new cases fail before (no length check existed, so a >200-char name reached `create` and `formData()` on a bad body throws uncaught), pass after: `Test Files 2 passed (2)`, `Tests 6 passed (6)`.
- Screenshots: none, not visual.
- Try it yourself: in Library, try creating a playlist with a name longer than 200 characters — you should see a plain error, not a stack trace.
**Risk:** low, input validation only.
