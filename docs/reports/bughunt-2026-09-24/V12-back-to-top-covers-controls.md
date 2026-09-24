# V12. The Back to top button covered controls on the right edge

**What you'd notice:** scrolled to the bottom of a long page, the round
Back to top button sat on a control you might want (a song's heart, the
"refresh recommendations" button) and there was no way to scroll it clear.

**Why it happened:** the button floated at a fixed height above the
window's bottom edge, and pages ended right at that height. Without a song
in the player bar it floated over the page even higher.

**What changed:** the button now sits a small fixed step above the bottom
of the scrolling area itself, whether or not the player bar shows, and
every page ends with 40 px of extra room, so the last row always stops
above the button. Files: `apps/web/components/nav/BackToTop.tsx`,
`apps/web/app/(app)/layout.tsx`.

**Compare:** before = `64f31f2`, after = `a19ff15`.
- Test: `node tests/layout-v12-back-to-top.test.mjs` (app 3053, PB 8086):
  fails before, 12/16 (`hits:["button \"Unlike\" @620"]`,
  `hits:["button \"Refresh recommendations\" @631"]`), passes after, 16/16.
  RTL: `npx vitest run components/nav/BackToTop.test.tsx`: before
  `expected 'fixed right-6 ...' to contain 'absolute'`, after 2/2.
- Screenshots: shots/V12-before.png vs shots/V12-after.png (390 px,
  playlist scrolled to the end, no song loaded)
- Try it yourself: open a long playlist or Liked songs and scroll to the end.

**Risk:** low. While you scroll through the middle of a list the button
still floats over whatever passes under it, as any floating button does;
a short scroll moves a row out from under it.
