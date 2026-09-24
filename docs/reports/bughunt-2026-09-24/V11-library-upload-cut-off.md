# V11. Library header: "Upload" cut off on small phones

**What you'd notice:** on a 360 or 375 px wide phone, the Library page's
Session / Join / Upload buttons ran past the right edge, so "Upload" was
cut in half.

**Why it happened:** the title and the three buttons had to share one row
and were not allowed to wrap, so on a narrow screen the row was wider than
the page.

**What changed:** the row may now wrap. On a narrow phone the buttons sit on
their own line under the title. On wider screens (desktop included) nothing
moves. Files: `apps/web/app/(app)/library/page.tsx`.

**Compare:** before = `62272b4`, after = `6d160df`.
- Test: `node tests/layout-v11-library-header.test.mjs` (app on 3053, PB on
  8086): fails before, 1/5 (`360px: ... "outside":[{"label":"Upload",
  "left":285,"right":377}]`, `overflow 41px`), passes after, 5/5 (desktop
  check: the buttons are still on the title row at 1280).
- Screenshots: shots/V11-before.png vs shots/V11-after.png (360 px)
- Try it yourself: open Library in a browser window 360 px wide.

**Risk:** low, one class change on one header. At 390 the buttons now sit
under the title too, which also stops the title wrapping onto two lines.
