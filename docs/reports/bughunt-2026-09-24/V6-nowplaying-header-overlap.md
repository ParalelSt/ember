# V6. Now Playing sheet: top buttons float over the content when scrolled

**What you'd notice:** on a phone, open the full-screen player and scroll down towards the lyrics: the song title, the heart/add/share buttons and the artwork slide underneath the close arrow, the guitar and the queue buttons, so both are hard to read and tap.

**Why it happened:** those three buttons were pinned on top of a scrolling area that filled the whole screen, with no background of their own, so everything that scrolled up passed right under them.

**What changed:** the three buttons now sit in their own row at the top, and the scrolling area starts below that row, so content disappears at the row's edge instead of going under the buttons. The row has no background, so the unscrolled sheet looks the same as before (the artwork is about 4px lower). Files: `components/player/NowPlaying.tsx`.

**Compare:** before = `38187fe` (sheet code unchanged since `62272b4`, where the failing run was taken), after = `6c9a85b`.
- Test: `node tests/layout-v6-nowplaying-header.test.mjs`: fails before (2/5), passes after (5/5).
  - before: `scrolled 600px (actual 600): no content under Close / Guitar tabs / Queue: Close over span "Let Down" | Close over a "Radiohead" | Guitar tabs over button "Add to playlist"`
  - after: nothing under the buttons at 0, 150, 300 and 600px scrolled.
- RTL: `npx vitest run components/player/NowPlaying.test.tsx`: the new layout test fails before, 3/3 pass after.
- Screenshots: shots/V6-before.png vs shots/V6-after.png (top of the sheet, 390 wide, scrolled 600px).
- Try it yourself: on a phone, play a song, tap the bar, scroll down slowly.

**Risk:** low. Same buttons, same actions; only where they sit relative to the scrolling area.
