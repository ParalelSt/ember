# N9. The readability check missed dropdown/menu highlight rows

**What you'd notice:** nothing directly wrong on screen from this bug itself, but a custom theme could pass the "is this readable?" check in Settings > Appearance and still leave menu and dropdown highlight rows (the row a hover or open dropdown lights up) with text that's hard to read against it.

**Why it happened:** the guard checked text against the app's "hover row" colour (a small lightness bump on the surface colour) but not against the slightly bigger bump actually used for menu and dropdown highlights (shadcn's own `--accent`, a different lightness step than the hover row). A theme could clear the hover check while still failing on the highlight it never looked at.

**What changed:** added the missing pair — text on the menu-highlight colour — to the same guard used for every other readability check (blocks saving when it fails, offers a one-click fix otherwise). Checked all five presets against it: all five still pass with nothing above "ok", so no preset colours needed changing. Files: `apps/web/lib/theme/guard.ts` (new `menu` pair), `apps/web/lib/theme/guard.test.ts`, `apps/web/lib/theme/presets.test.ts` (pair count updated).

**Compare:** before = `f139dc3^` (i.e. `972625f`), after = `f139dc3`.
- Test: `npx vitest run lib/theme/guard.test.ts lib/theme/presets.test.ts`: fails before (`rates all seven pairs...` finds only six; `catches text on the menu-highlight row too...` throws `Cannot read properties of undefined (reading 'level')`), passes after: `Test Files 2 passed (2)`, `Tests 36 passed (36)`.
- Screenshots: none, not visual (this only changes what the readability guard flags, not any preset's actual colours).
- Try it yourself: in Settings > Appearance > Colours, push Surface's lightness up until Text on highlighted rows shows a warning — the new "Text on menu highlights" finding should appear there too (open a dropdown menu like the track's "..." menu to see the actual row it's protecting).
**Risk:** low: a stricter check only, and every existing preset already passes it, so nobody's saved theme is retroactively broken.
