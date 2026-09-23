# 11. Settings tabs at 390px: Plugins/Help off-screen with no hint

**What you'd notice:** on a phone, opening Settings > Plugins or Settings >
Help (from a link, or after a page refresh) can land you on a tab that's
scrolled off the right edge of the tab row, with nothing on the page hinting
you can scroll sideways to find it.

**Why it happened:** the tab row was a plain horizontal scroller below the
tablet breakpoint. Nothing scrolled the current tab into view when you
landed on it, and there was no visual cue (like a fade at the edge) telling
you the row scrolls at all.

**What changed:** the active tab now scrolls itself into view whenever you
navigate to it, and a fade appears at each edge of the row (below the
tablet breakpoint only) built from the theme's own background colour, so it
looks right in every theme instead of using a hardcoded colour. Files:
`apps/web/components/settings/SettingsTabs.tsx`.

**Compare:** before = `2428c44` (parent commit's tabs code, unchanged by
W09/W10), after = `0ea0ebe`.
- Test: `node tests/layout-w11-settings-tabs.test.mjs`: before, 3/5 pass,
  with the Help tab's box outside the scroller's visible box
  (`linkLeft:459.6 ... scrollerRight:366`) and the same for Plugins; after,
  5/5 pass, and the desktop vertical layout is confirmed unchanged at
  1280/1920.
- Screenshots: shots/11-before.png vs shots/11-after.png
- Try it yourself: on a phone-width browser, open `/settings/help` or
  `/settings/plugins` directly.

**Risk:** low, layout-only change to the settings tab row.
