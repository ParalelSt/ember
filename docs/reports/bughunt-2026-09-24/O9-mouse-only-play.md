# O9. Some play buttons only worked with a mouse

**What you'd notice:** in the search page's "Recent searches" list, and in
the queue sheet's "Next up" list, the only way to start a song was to click
the row itself. There was no visible or keyboard-reachable Play button on
either row. On the phone player bar, tapping the song title to open the
full-screen view worked with a finger, but the tap target wasn't a real
button at all: a keyboard or screen reader had no way to reach it.

**Why it happened:** `TrackRow` already had a `trailingPlayControl` option
that renders a real Play button, used by the search overlay and other rows,
but the search page and queue sheet never passed it. The phone player bar's
title area was a plain `<div onClick>`, invisible to Tab and to
accessibility tools.

**What changed:** `trailingPlayControl` is now passed in `QueueSheet` (Next
up rows) and on `/search` (Recent searches rows), giving both a real,
keyboard-focusable Play button. The phone player bar's title area is now a
real `<button aria-label="Open player">` instead of a div, with the same
look. Files: `components/player/QueueSheet.tsx`, `app/(app)/search/page.tsx`,
`components/player/PhonePlayerBar.tsx`.

**Compare:** before = `e44acbd`, after = `db8d072`.
- Test: `cd apps/web && npx vitest run components/player/QueueSheet.test.tsx "app/(app)/search/page.test.tsx" components/player/PhonePlayerBar.test.tsx`: 4 checks fail before (no `Play <title>` / `Open player` button found), 19/19 pass after.
- Screenshots: `shots/O9-before.png` vs `shots/O9-after.png` (the search recents row at phone width: no play control before, a Play icon after).
- Try it yourself: on a phone-width window, open Search with a recent search showing; before, only tapping the row played it; after, a Play button sits beside it. Tab to the player bar's title/artwork; before, focus skipped it; after, it takes focus and Enter opens the full-screen view.

**Risk:** low. Additive UI (existing option turned on) and a div-to-button swap with the same layout classes; behavior for existing taps and clicks is unchanged.
