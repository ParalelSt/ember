# O8. Play/remove buttons vanish when you tab to them

**What you'd notice:** tabbing through a track list or the recent-searches
row with the keyboard, the play button and the little remove (x) button
never appear. They only ever showed up on mouse hover, so a keyboard user
had no way to see what they were about to press.

**Why it happened:** the buttons were hidden with `opacity-0` and only
revealed by `group-hover`, a mouse-only CSS state. Keyboard focus never
triggered it, so the control stayed invisible even while it had focus and
could be activated with Enter.

**What changed:** added `group-focus-within` and `focus-visible` to the
same reveal rule, so focusing the row or the button itself shows it, exactly
like hover already did. Files: `components/track/TrackCard.tsx` (hover play
button), `components/track/TrackRow.tsx` (compact remove button, rank-column
play button).

**Compare:** before = `a2b200c`, after = `a1ddcac`.
- Test: `cd apps/web && npx vitest run components/track/TrackCard.test.tsx components/track/TrackRow.test.tsx`: 3 new checks fail before (`expected '...' to contain 'group-focus-within:opacity-100'`), 56/56 pass after.
- Screenshots: `shots/08-before.png` vs `shots/08-after.png` (the recent-searches row on `/dizajn/sve`, remove button focused with the keyboard: invisible before, a visible X after).
- Try it yourself: open any track list, click into the page, press Tab until a row's play button has focus; before, nothing showed; after, the play button appears.

**Risk:** low. Pure CSS addition; no behavior or markup changed.
