# F2. Settings > Appearance fits on a desktop screen
**Status:** done (owner's request: "I want this to fit on screen easily because it's kinda hard to see like this.").

**What you'd notice:** on a desktop window, Settings > Appearance now fits between the page heading and the player bar. The whole preview shows, its little player row included, and the Apply bar and the Themes / Colours / Share tabs are always in view. When a tab's list is longer than the space (Colours always is on a laptop), that list scrolls inside the inspector; the page itself stays put. Each tab opens at its top. On a phone nothing changed: preview on top, inspector under it, the page scrolls as before.

**Before:** at 1512x830 with the player bar showing, the inspector (presets, My themes, Shared by others) ran under the player bar and the whole page had to be scrolled to reach it, carrying the preview away. On shorter windows the preview itself ran past the bar: at 1280x720 its bottom was at 732 px with the bar starting at 627, so its player row was hidden; at 1440x800, 732 against 707. In Chromium at 1512x830 the preview just cleared the bar (732 against 737); in the owner's Firefox, with a few pixels less of viewport, it did not.

**What changed:**
- From xl (1280 wide) the preview + inspector row is as tall as what is left of the page scroller: `--ember-scroller-h` (already set by the app layout) minus the row's own distance from the scroller's top, measured by a new `useScrollerOffset` hook (kept current on resize, the player bar appearing, a heading wrapping), minus one `--spacing-block` of air above the player bar. A floor of `min-h-96` keeps a very short window usable (the page scrolls then, as before).
- The preview fills that height up to its old 32rem (`max-h-128`), so at 1920x1000 it looks exactly as before; on shorter windows its track rows give way while its sidebar, header and player row stay (the existing `min-h-0` / `shrink-0` flex, no scaling).
- The inspector is a column: Apply bar, tabs and status line on top, the tab's content in a new `inspector-scroll` panel (`min-h-0 flex-1 overflow-y-auto`, with an inset so focus rings are not clipped at its edge). It is keyed on the tab, so switching tabs opens the new one at its top instead of at the old one's scroll position.
- Spacing tokens only, no colours touched; below xl every class is as it was.
- Docs: `docs/themes.md` (the Appearance section and the Apply bar's sticky note).

Files: `apps/web/app/(app)/settings/appearance/page.tsx`, `apps/web/hooks/useScrollerOffset.ts` (new), their tests, `docs/themes.md`, `tests/appearance-fit-ui.test.mjs` (new), `tests/README.md`, `package.json` (`test:appearance-fit-ui`).

**Compare:** before = `2ed90ac`, after = `fec4e1a`.
- Unit: `cd apps/web && npx vitest run hooks/useScrollerOffset.test.tsx "app/(app)/settings/appearance"`. The new page test on the old page: `Tests 1 failed | 16 passed (17)` (no scrolling panel). After: all pass, plus 4 for the hook (distance below the scroller, the scrolled-away part counted, remeasure on resize and disconnect on unmount, null outside the scroller). Full `npx vitest run`: `Test Files 269 passed (269)`, `Tests 3009 passed (3009)`. `tsc --noEmit` and eslint on the changed files: clean.
- Browser (app 3055 on a `next build --webpack` of this branch with `POCKETBASE_URL=http://127.0.0.1:8084`, PocketBase 8084 over a scratch copy of the hooks and migrations with `--automigrate=0`, superuser from `EMBER_PB_SUPERUSER_*`): `EMBER_PB_SUPERUSER_EMAIL=... EMBER_PB_SUPERUSER_PASSWORD=... PB_URL=http://127.0.0.1:8084 APP_URL=http://127.0.0.1:3055 node tests/appearance-fit-ui.test.mjs`. On the before build: `16/30 checks passed` (the preview past the player bar at 1280x720 and 1440x800, no inspector panel of its own at any size). After: `34/34 checks passed`, for example at 1280x720 the preview ends at 611 with the bar at 627, the Colours list scrolls to 365 while the page stays at 0; at 1512x830 the preview ends at 721 with the bar at 737. `node tests/themes-ui.test.mjs` on the after build: `74/74 checks passed`.
- Screenshots at 1512x830, Midnight picked, not applied: before `shots/F2-before.png` (the list runs under the player bar, "My themes" cut mid-line), after `shots/F2-after.png` (the preview, Apply bar, tabs and presets all in view above the player bar, My themes at the panel's bottom edge to scroll to).
- Try it yourself: on a laptop window with a song in the player bar, open Settings > Appearance. Everything from the heading to the preview's player row is on screen. Open Colours and scroll: only the colour list moves. Go back to Themes: it opens at Presets.

**Left as is:**
- The blank status line between the tabs and the list (it holds "Applied" and error lines) is still there; at 1280x720 the list still gets about 230 px.
- lg (1024 to 1279 wide) keeps the stacked layout, as before; the fit starts at xl, where the preview and inspector sit side by side.
- The preview shrinks by giving up track rows rather than scaling down as a picture; at the smallest size checked (1280x720, preview 391 px tall) all three stand-in rows still show, checked on a screenshot.

**Risk:** low. One page's layout at xl and up, one small measuring hook; no data, routes or theme logic touched, and the stacked layout below xl is unchanged.
