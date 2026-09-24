# V10. Deleting the theme you were using left it on screen with nothing selected
**Status:** fixed.
**What you'd notice:** in Settings > Appearance, deleting one of your own themes while it was in use kept its colours on the whole app, but no theme in the list was selected, and it stayed that way after a reload.
**Why it happened:** deleting it used the same rule as when someone else's shared theme disappears: keep a loose copy of the colours so nobody's look changes under them. For your own theme that makes no sense: you chose to delete it.
**What changed:** when you delete your own theme while using it, you go straight back to the preset it was built on (for example Midnight), and that preset shows as selected. Someone else's shared theme vanishing still leaves them a kept copy, as before (N2, X12). Files: `apps/web/app/api/themes/[id]/route.ts`, `docs/themes.md`.
**Compare:** before = `3e4f034`, after = `ac9414d`.
- Test: `cd apps/web && npx vitest run app/api/themes hooks/useThemeEditor.test.tsx`: fails before (`expected { ok: true, active: { v: 1, …(3) } } to deeply equal { ok: true, active: { v: 1, …(1) } }`: the answer still held the deleted theme's colours), passes after (`Tests 25 passed`). New cases: deleting a theme you're not using changes nothing, and someone else using your shared theme still keeps their copy after you delete it.
- Browser (app 3055, PocketBase 8084): pick Midnight, change the accent (saves "My Midnight"), delete it. Before: `after delete []`, `/api/theme` still the green custom colours. After: `after delete [Midnight]`, accent back to Midnight's blue, `/api/theme` = `{"v":1,"preset":"midnight"}`, same after reload.
- Screenshots: shots/V10-before.png vs shots/V10-after.png
- Try it yourself: on the sandbox, Settings > Appearance, pick Midnight, change a colour on Colours, go back to Themes and delete "My Midnight": Midnight is selected and the app turns Midnight blue.
**Left as is:** the grey "Saved as My Midnight" line above the list stays until the next change, though that theme is gone.
**Risk:** low. Only the owner's own delete of the theme in use changes; the kept-copy path for everyone else is unchanged and still tested.
