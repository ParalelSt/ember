# 10. Long playlist names run off the page

**What you'd notice:** a playlist with a very long, unbroken name (for
example "Supercalifragilisticexpialidocious…") spills past the right edge
of the page instead of wrapping, on both phone and desktop.

**Why it happened:** the title's text box didn't stretch to the page's width
and its text had no permission to break mid-word, so one long word with no
spaces just kept going past the edge of the screen instead of wrapping.

**What changed:** the title now wraps (breaking mid-word if it has to) and
is capped at 3 lines with an ellipsis after that, and its column now takes
the full width available so it can't be pushed wider than the page. Files:
`apps/web/components/page/CollectionHeader.tsx`.

**Compare:** before = `2428c44` (parent commit's title code, unchanged by W09),
after = `b2eb841`.
- Test: `node tests/layout-w10-playlist-header.test.mjs`: before, 4/7 pass,
  with the title's box reported as `right=2200 vw=390` (and similarly past
  the edge at 1280/1920); after, 7/7 pass.
- Screenshots: shots/10-before-390.png vs shots/10-after-390.png (phone),
  shots/10-before-1280.png vs shots/10-after-1280.png (desktop)
- Try it yourself: open a playlist with a long, unbroken name at any width.

**Risk:** low, affects only the shared title header used by playlists,
albums, artists and the Liked/Recent/Uploads pages; capped at 3 lines
everywhere.
