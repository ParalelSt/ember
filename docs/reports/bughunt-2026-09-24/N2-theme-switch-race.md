# N2. Switching theme right after an edit could undo the switch

**What you'd notice:** edit a colour on one of your themes, then almost immediately switch to a different theme (preset, or another saved theme). Occasionally the switch would silently revert: you'd end up back on the theme you were just editing.

**Why it happened:** two things had to line up. First, on the client, switching didn't wait for the colour edit's save to actually land before asking the server to switch, so the two requests could cross in flight. Second, on the server, saving an edit checks "is this theme still the one in use?" before writing it back to your account, but that check and the write were two separate steps: if a switch landed in the gap between them, the edit-save's write went through anyway and clobbered the switch.

**What changed:** the client now waits for a save already in flight to finish before it asks to switch. The server now runs that check-then-write as one uninterruptible step per account, so a switch that arrives while an edit-save is mid-flight either lands cleanly after it or is already reflected by the time the edit-save checks. Files: `apps/web/hooks/useThemeEditor.ts` (leave() awaits the flush), `apps/web/lib/theme/serverActive.ts` (new per-user write lock), `apps/web/app/api/theme/route.ts`, `apps/web/app/api/themes/[id]/route.ts`.

**Compare:** before = `4ad3bb4`, after = `3e01179`.
- Test: `npx vitest run hooks/useThemeEditor.test.tsx app/api/themes/themes-race.test.ts`: the N2 client case fails before (`save:done` lands after `switch` instead of before: `['switch', 'save:start']` vs expected `['save:start', 'save:done', 'switch']`), and the server race test fails before (`active` ends up back on the edited theme: `themeId: 'theme0000000001'` instead of `'theme0000000002'`); both pass after: `Test Files 2 passed (2)`, `Tests 4 passed (4)`.
- Screenshots: none, not visual.
- Try it yourself: drag a colour, then within a second click a different preset a few times in a row — the app should always land on the last preset you picked, never snap back to the one you were editing. This was intermittent (about 1 in 10) even before the fix, so a single try proves nothing either way; the tests above are the real proof.
**Risk:** medium: the server change adds a per-account write lock around `users.theme`, touching every path that reads or writes the active theme (switch, edit-save, delete, and the background refresh on GET). Covered by the existing `themes-routes.test.ts` suite (all still passing) plus the new race test.
