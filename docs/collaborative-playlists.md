# Collaborative playlists

A playlist's owner lets other people on this server edit its songs.

## What each person can do

| | Owner | Member | Anyone else (admins too) |
|---|---|---|---|
| See it, play it, download it | yes | yes, while it is collaborative | no (404) |
| Add, remove, reorder, replace, copy songs in | yes | yes | no |
| Rename, change the cover, delete | yes | no (403) | no |
| Share or stop sharing | yes | no | no |
| Add or remove people, invite link | yes | no | no |
| Leave | | yes | |

The owner shares from the people chip under the playlist's title (everyone's
faces and "Invite", or "+ Invite" while it is only them) or the playlist's
⋯ menu (Collaborate). Both open the share sheet, link first: one big "Copy
invite link" turns sharing on, makes a link and copies it (there is no
separate switch); once a link exists, Copy link, New link and Turn off
link. Under it "People who can edit" with Add by name (adding someone also
turns sharing on), and Stop sharing at the end.

Members see it in their library with a "Shared by <owner>" pill with the
owner's face (the sidebar keeps a small people mark), and the same pill
under the playlist's title. In a collaborative playlist every song shows
who added it (a small picture, and the name where the row is wide enough).
Names only: nobody but an Ember admin sees an email address, and an admin
only in the share sheet's people picker.

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
  The join page first shows a preview card (cover, "<owner> invited you to
  edit", faces and song count, the first 3 songs, Not now / Join) from
  `POST /api/playlists/join/preview { code }`, which adds nobody. It
  answers only a signed-in caller and only for a live link (the same 404 as
  the join for a malformed, unknown, replaced or turned-off code, or a
  playlist no longer shared), with names and faces only (never an email or
  a user id) and the playlist id only to someone already on it, who goes
  straight there. Join POSTs the code to `/api/playlists/join` (a link
  preview never joins anyone); Not now leaves the link working. Signed
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

"Edit order" in the list toolbar, for everyone who can open the playlist
(phone and desktop alike). It switches the list to the playlist's own
order, and the rows get up and down arrows and a drag handle (no heart, no
number). Done saves and says "Order saved": `planMoves` in `lib/collab.ts`
works out the fewest single moves, sent one after the other as
`POST /api/playlists/:id/tracks/move { trackId, to }`, which moves one song
in the server's current order and renumbers the rows. A song someone else
added meanwhile stays, after the rest.

## Tests

- `lib/collab.test.ts`, `app/api/playlists/collab-routes.test.ts` (every
  route for owner, member, outsider and admin, against
  `test-utils/fakePlaylistPb.ts`, a fake that follows the real rules), the
  bulk route test, and the component tests (CollaborateSheet,
  useCollaborateSheet, PeopleChip, SharedByBadge, CollectionCard,
  ReorderList, CollectionPage, PlaylistMenu, TrackRow, TrackMenu,
  AddToPlaylistMenu, PlaylistNavList, the join page).
- `tests/collab-rbac.test.mjs` and `tests/collab-ui.test.mjs` against a
  throwaway sandbox (`tests/README.md`).
