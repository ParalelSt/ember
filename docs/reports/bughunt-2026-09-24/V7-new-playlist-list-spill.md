# V7. New playlist dialog: recommended list spills past the footer

**What you'd notice:** in "New playlist" (from a song's + menu), once the recommendations load, the list runs under Cancel / Create and out of the bottom of the dialog, on desktop and on a phone.

**Why it happened:** the list had its own height limit (60% of the window, or 384px on a phone), but the dialog is only allowed 90% of the window and the box around the list refused to get smaller, so the list kept its full height and poked out.

**What changed:** the box around the list may now shrink, so in the dialog the list takes the space that is left and scrolls inside it. On the playlist page (no height cap) it looks as before. Files: `components/track/menus/TrackSearchPicker.tsx`.

**Compare:** before = `0e2c3fd` (picker code unchanged since `62272b4`, where the failing run was taken), after = `e9713cf`.
- Test: `node tests/layout-v7-new-playlist-dialog.test.mjs`: fails before (8/10), passes after (10/10).
  - before: `1280px: the recommended list ends above the footer: list 349-829, footer 695-760` (the dialog ends at 760); `390px: list 354-738, footer 697-802`
  - after: `list 349-667, footer 695-760` and `list 354-669, footer 697-802`.
- RTL: `npx vitest run components/track/menus/TrackSearchPicker.test.tsx`: fails before, passes after.
- Screenshots: shots/V7-before.png vs shots/V7-after.png (1280x800 over 390x844). The test serves 20 made-up recommendations, so it does not depend on YouTube.
- Try it yourself: on any song, + then New playlist, wait for the recommendations.

**Risk:** low. One wrapper class; the list's own height limit is unchanged.
