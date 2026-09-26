# Collaborative playlists

A playlist's owner lets other people on this server edit its songs.

## What each person can do

| | Owner | Member | Anyone else (admins too) |
|---|---|---|---|
| See it, play it, download it | yes | yes, while it is collaborative | no (404) |
| Add, remove, reorder, replace, copy songs in | yes | yes | no |
| Rename, change the cover, delete | yes | no (403) | no |
| Turn collaboration on or off | yes | no | no |
| Add or remove people, invite link | yes | no | no |
| Leave | | yes | |

Members see it in their library and sidebar with a people mark and
"Shared by <owner>". In a collaborative playlist every song shows who added
it (a small picture, and the name where the row is wide enough). Names only:
nobody but an Ember admin sees an email address, and an admin only in the
Collaborate sheet's people picker.

## How it works

- `pocketbase/pb_hooks/ensure_collab_playlists.pb.js` adds
  `playlists.collaborative`, `playlists.invite_code`,
  `playlist_tracks.added_by` and the `playlist_members` collection
  (playlist, user). `playlist_members` has no client rules: only the server
  reads and writes it.
- Nothing about collaboration is opened in PocketBase's own rules.
  `playlists` and `playlist_tracks` stay owner-only
  (`ensure_owner_rules.pb.js`), so through `/pb` a member cannot read, list,
  subscribe to or write someone else's playlist. The hooks also refuse any
  client (the owner too) that sets `collaborative` or `invite_code`, or
  names someone else in `added_by`.
- The routes under `apps/web/app/api/playlists` call
  `lib/playlistAccess.ts`: the owner keeps using their own session (so
  PocketBase checks everything again); a member of a playlist that is
  collaborative right now gets the server's admin client, after that check;
  anyone else gets the same 404 as a playlist that does not exist.
- Turning collaboration off clears the invite link and hides the playlist
  from its members; the member list is kept, so turning it back on lets the
  same people in again. Turning it on marks the songs already there as the
  owner's.
- The invite link is `/playlist/join/<code>`, 24 random bytes as base64url.
  The join page POSTs the code (a link preview never joins anyone); signed
  out, `proxy.ts` sends the browser to sign in and back. A new link replaces
  the old one, and so does the owner removing someone while the link is
  on (or they could open it again). Only a well-formed code is ever looked
  up. A member can leave while collaboration is off.
- A member's account being deleted keeps the songs they added (`added_by`
  is emptied, the row shows no one).
- Up to 50 people per playlist (`MAX_MEMBERS` in `lib/collab.ts`).
- Changes show up by polling, like carlists: an open collaborative playlist
  refetches every 5 s, the playlist list every 30 s (only while the page is
  visible). PocketBase realtime does not stream through `/pb` under
  `next start` (`tests/pranks-realtime.spike.mjs`).

## Reordering

Move up / Move down in a row's menu (the More menu on a wide window, the +
menu on a phone), only while the list is shown in the playlist's own order
(the default sort). `POST /api/playlists/:id/tracks/move { trackId, to }`
moves one song in the server's current order and renumbers the rows.

## Tests

- `lib/collab.test.ts`, `app/api/playlists/collab-routes.test.ts` (every
  route for owner, member, outsider and admin, against
  `test-utils/fakePlaylistPb.ts`, a fake that follows the real rules), the
  bulk route test, and the component tests (CollaborateSheet, PlaylistMenu,
  TrackRow, TrackMenu, AddToPlaylistMenu, PlaylistNavList, the join page).
- `tests/collab-rbac.test.mjs` and `tests/collab-ui.test.mjs` against a
  throwaway sandbox (`tests/README.md`).
