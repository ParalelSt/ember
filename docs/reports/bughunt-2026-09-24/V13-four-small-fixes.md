# V13. Four small fixes: menu names, reset title, tabs 404, missing uploads
**What you'd notice:** (1) the "+" add-to-playlist menu cut long names off
mid-letter; (2) Admin "Reset password for <long email>" ran under the X;
(3) the tab page logged a red 404 for songs with no generated tab; (4) Admin
> Tracks listed songs whose upload was deleted, as if they still played.
**Why it happened:** (1) an ellipsis never shows on bare text in a flex
row; (2) no room was kept for the X; (3) "nothing yet" was sent as 404,
which browsers log as an error; (4) deleting an upload keeps its catalog
row (playlists may hold it) and the admin list never checked.
**What changed:** (1) the name gets its own box ending in "…"; (2) the title
keeps clear of the X and wraps long emails; (3) "nothing yet" is now 204, an
ordinary empty answer; (4) such rows say "Missing" in red, nothing deleted.
Files: `AddToPlaylistMenu.tsx`, `password-reset-dialog.tsx`, the tabs
`generated/[trackId]` and `admin/tracks` routes, `admin/tracks/page.tsx`,
new `lib/uploads/missing.ts`.
**Compare:** before = `b0aa6df`, after = `dd2f3b7`.
- Test: `node tests/layout-v13-small-fixes.test.mjs`: before 2/7
  (`"display":"flex"`, `titleRight 358 > closeLeft 338`, `status 404`,
  `"Deleted Upload 1":false`), after 7/7. Unit: `tabs-routes.test.ts`
  before `expected 404 to be 204`, after pass; new `missing.test.ts`.
- Screenshots: shots/V13-before.png vs shots/V13-after.png (menu, dialog,
  Admin Tracks, top to bottom)
- Try it yourself: "+" on a song with a long-named playlist; Admin > Users
  > key icon on a long email; Admin > Tracks after deleting an upload.
**Risk:** low. `tests/tabs-generate.test.mjs` now expects 204, not 404.
