# V1. Desktop player bar loses the song title from 768 to about 1279 wide

**What you'd notice:** in a narrow desktop window the bar at the bottom showed no song name at all (1024), the like/add/share buttons ran over the artwork and the loop button (768), and at 1280 the name was cut to "Let Do...".

**Why it happened:** the bar always gave the song's side a quarter of the width, and that quarter also had to hold three buttons, so on a narrow window the name got whatever was left, which was nothing.

**What changed:** the name's side now has a minimum width. Below 1280, add and share move into a new "..." menu beside the heart (with "Add to playlist" and your playlists under it). Below 1024, lyrics and guitar tabs move into that menu too and the volume slider hides (the mute button stays). From 1280 up nothing moves, the name just gets more room; at 1920 the bar is identical. Files: `components/player/PlayerBar.tsx`, `components/track/menus/AddToPlaylistMenu.tsx` (optional "..." mode), `components/track/ShareButton.tsx` (share logic reusable from a menu).

**Compare:** before = `62272b4`, after = `f05068c`.
- Test: `node tests/layout-v1-player-bar.test.mjs`: fails before (14/21), passes after (21/21).
  - before: `768px: the title gets at least 60px: title 0px`, `1024px: ... title 0px`, `1280px: ... title 57px`, `768px: no two things in the bar overlap: artwork x Like (32px) | artwork x Loop playlist (18px)`
  - after: title 76px (768), 124px (1024), 144px (1280), 228px (1920, same as before); no overlaps; 1920 columns unchanged.
- RTL: `npx vitest run components/player/PlayerBar.test.tsx`: 5 failed before, 13/13 after.
- Screenshots: shots/V1-before.png vs shots/V1-after.png (768, 1024, 1280, 1920 stacked); shots/V1-after-menu.png (the "..." menu at 768).
- Try it yourself: play a song, narrow the desktop window to about 1000 wide: the name stays readable and "..." holds Share, then your playlists.

**Scope note:** at 1024 to 1279 the volume slider is shorter (80px instead of 118px) so the seek bar keeps room. At 1280 the seek bar is about 90px shorter than before, to give the name room.

**Risk:** low. Layout only; the same add, share, lyrics and tabs actions are reachable at every width.
