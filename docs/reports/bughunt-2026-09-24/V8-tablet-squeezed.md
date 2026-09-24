# V8. Tablet (768 px) layouts squeezed
**What you'd notice:** on a tablet-width window, Home drew 5 song cards
across ~460 px (80 px cards, titles cut to "Let ..."), and Settings and
Admin put a side menu next to the page, leaving it ~230 px: Admin > Tracks
titles were one letter wide and the Appearance preview was clipped.
**Why it happened:** shelves chose their columns from the window's width,
not from the space left beside the sidebar, and the settings/admin side
menu switched on at the same tablet size the app's own sidebar does.
**What changed:** each shelf now measures its own width and picks columns
from that (3 at 768), and the settings/admin side menu starts at the wider
laptop size; below it they use the tab row across the top that phones
already use. Phone (390) and desktop (1280) are unchanged, pixel for pixel
(only the build stamp differs). Files: `lib/layout.ts`,
`components/track/TrackShelf.tsx`, the settings and admin `layout.tsx`,
`SettingsTabs.tsx`, `AdminTabs.tsx`.
**Compare:** before = `b75aec5`, after = `78d0bd8`.
- Test: `node tests/layout-v8-tablet.test.mjs`: before 7/13
  (`"perRow":5,"cardWidth":80`, `"pageWidth":232`, `title width 18`),
  after 13/13 (390: 2 cards, 1280: 6, or 4 with lyrics open, as before).
  RTL: `TrackShelf.test.tsx` before `expected [ …(5) ] to have a length
  of 3`, after pass; `lib/layout.test.ts` pins the widths.
- Screenshots: shots/V8-before-768.png vs shots/V8-after-768.png; the 390
  and 1280 pairs (V8-before/after-390, -1280) are identical.
- Try it yourself: a 768 px window on Home, Settings, Admin > Tracks.
**Risk:** low. At 1024 Home shows 5 cards a row instead of 6.
