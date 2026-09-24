# Playlist copy: build plan (after the pick)

> **For agentic workers:** use superpowers:subagent-driven-development or superpowers:executing-plans, task by task, checkbox (`- [ ]`) steps. Written at the design stage: the candidates are on `/dizajn`, nothing below is built yet.

**Goal** (the owner's words, 2026-09-24): copy songs from one playlist to another. Select one by one, or all; sort; copy into another playlist, a new playlist, or Liked songs. Copying into Liked songs likes every one of them, and the app says so before it happens. Duplicates are checked, with the same-title fix: two different songs that only share a title are both copied.

**Branch and servers.** Worktree `/Users/aronmatoic/Documents/Main Projects/spotify-clone-wt/playlist-copy`, branch `playlist-copy` (off `bughunt`). Never `npm install`, `ci` or `version` there (node_modules are symlinks into the main checkout). Own sandbox only: app 3052, PocketBase 8087 on a scratch data dir (`pocketbase migrate up` into it, then `serve --automigrate=0` with this checkout's hooks, `EMBER_PB_SUPERUSER_*` and `EMBER_ADMIN_*` from the environment, tests/README.md W14). Never touch 3050/8088, 3051/8089 or 3000/8090. No em dashes anywhere.

**Task 0 (done):** three candidates on `/dizajn` (`components/library/options/playlist-copy/`): Checkbox column (recommended), Tap to select, Copy songs dialog. The owner picks one; the loser code is deleted in the same commit that clears `/dizajn` (as the Pranks and themes questions were cleared).

---

## 1. The duplicate rule

One rule, the one the Liked hearts already use: **a picked song is already in the destination when a track there has the same id, or the same `songKey`** (`findLikedVariant(track, destination)` in `lib/songKey.ts`). No new matching code: the copy uses the function the hearts use, so the two can never disagree.

What `songKey` means since the same-title fix (4fbdb92, "two songs that only share a title are not the same song"), and why it is the right bar for "duplicate":

| Case | Duplicate? | Why |
| --- | --- | --- |
| Same track id | yes (`same-track`) | the unique index `(playlist, track)` / `(user, track)` would refuse it anyway |
| "Harbor Lights" vs "Harbor Lights (Official Video)" by "Coastline - Topic" | yes (`other-version`) | bracket noise, "official/video/lyrics/remaster", feat. spelling and "- Topic"/VEVO are stripped |
| "Home" by Edward Sharpe vs "Home" by Phillip Phillips | **no** | the artist is part of the key |
| "Звезда" by Виктор Цой vs "Звезда" by another band | **no** | a non-Latin title or artist falls back to the raw lowercase text instead of normalising to nothing (the original bug: every such song keyed `title::::`) |
| "Звезда" vs "Звезда (Official Video)", same artist | yes | `rawTitle` still strips bracket noise |
| Two uploads called "Home" with no artist | **no** | an artist-less track keys on its own id (`id:<id>`), so it only matches itself |
| "Northbound" vs "Northbound (Live)" / remix / instrumental / acoustic / sped up | **no** | `variantMarkers` is part of the key: a different recording |
| Two picked songs that are the same song | the second is skipped (`picked-twice`) | checked against what this copy already added |

The pure function lives in `components/library/options/playlist-copy/model.ts` today (`alreadyThere`, `planCopy`, `sortTracks`, `resultLine`, `skipLine`, with `model.test.ts`). Task 1 moves it to `lib/playlistCopy.ts` unchanged, so the server routes and the client share it (the `lib/**` ESLint rule already forbids React there; it imports only `lib/songKey` and `types/track`).

**The server decides.** The client shows the counts up front ("2 already there, 13 to add") from the query cache, but the routes re-run `planCopy` against the database, so a stale cache, a second tab or a race can never add a duplicate. The unique indexes stay the last fence: a 400 from a create is counted as `same-track`, not an error.

## 2. API

PocketBase 0.22 has no batch endpoint, so both routes loop, with `lib/semaphore` capping parallel writes at 4. Both cap a request at 500 tracks (400 above that) and answer with the same shape:

```ts
{ added: number; skipped: { id: string; title: string; artist: string; reason: 'same-track' | 'other-version' | 'picked-twice'; existingTitle: string }[] }
```

- `POST /api/playlists/[id]/tracks/bulk`, body `{ tracks: Track[] }`. `requireUser`; ownership check first (404 "That playlist doesn't exist, or isn't yours", same as the single add). Reads the playlist's rows once (`expand: 'track'`, mapped with `mapTrackRow`), runs `planCopy`, then per added song `upsertCatalogTrack` and a `playlist_tracks` create at consecutive positions after the current highest (start at 1: PB's required number rejects 0). Keeps the picked order.
- `POST /api/likes/bulk`, body `{ tracks: Track[], confirmed: true }`. Without `confirmed: true` it answers 400 "confirm first": the "this likes every one of them" warning is not skippable by a stray call. Reads the member's likes once, runs `planCopy`, creates `likes` rows with `origin: 'user'` and `liked_at` = now minus i ms, so the copied songs land on top of Liked songs in the picked order. Invalidates nothing server side; the client invalidates `QK.likes`.
- New playlist: `POST /api/playlists` (exists) then the bulk route. If the bulk call fails, the client deletes the empty playlist it just made and says so.
- `GET /api/playlists/[id]` and `GET /api/likes` add `addedAt` (the junction row's `created`, the like's `liked_at`) to each track, as a `CollectionTrack = Track & { addedAt: string }` in `types/track.ts`. Needed for "Date added" sorting; existing callers ignore the extra field.
- `lib/api.ts`: `bulkAddToPlaylist(id, tracks)`, `bulkLike(tracks)`; `hooks/useLibrary.ts`: `useExecuteBulkAddToPlaylist` (invalidates `QK.playlist(id)` and `QK.playlists`) and `useExecuteBulkLike` (invalidates `QK.likes`).

## 3. Sorting: client side, remembered per collection on the device (recommended)

Sort is a view, not an edit: `sortTracks(tracks, { key, dir })` on the list the page already has, keys Title, Artist (then title), Date added, Duration, both directions, ties kept in list order. The choice is saved in `localStorage` under `ember-sort:<collection id>` (a `hooks/useCollectionSort(id)` hook), default Date added oldest first for a playlist (its own order) and newest first for Liked songs (today's order).

Why not persisted to the server: a persisted sort either rewrites `playlist_tracks.position`, which throws away the member's own order the first time they tap Title, or needs a new per-user-per-playlist field and a migration for a preference nobody has asked to carry between devices. Client side costs nothing, is instant, and can be promoted to a `playlists.sort` field later without changing the UI. Play and Shuffle follow the order on screen (TrackList already queues the list it is given).

## 4. UI (the picked candidate)

- `components/library/CollectionPage.tsx` gains select mode, so Liked songs, Uploads and Recently played get it too (their pages pass what they support). Presentational only: the selection state lives in a `hooks/useTrackSelection(tracks)` hook the page passes in, like `playback` and `download` are passed today.
- Checkbox column (recommended): `TrackRow` gets a `lead: 'check'` mode (the design-system column plan already has `lead`), a `selected` flag and `onSelect`; `TrackList` passes them. The bottom bar is a new `components/track/SelectionBar.tsx`, sitting just above the player bar (inside the main column, so it never covers the bar or the phone nav) with the safe-area class where it meets the screen edge; Copy to opens the existing dropdown on desktop and a `Sheet` on phones. The destination list reuses `useQueryPlaylists()` minus the source, plus "New playlist" and "Liked songs", each with the already-there count from `planCopy` against the cached lists (a playlist not in the cache shows its song count until opened).
- Tap to select: `TrackRow` gets `selected` + `onSelect` on the art box and a long-press (500 ms `pointerdown` timer, cancelled on move) on the row; the phone `TopBar` takes a `selectionBar` slot.
- Copy dialog: a new `components/track/menus/CopySongsDialog.tsx` on the base-ui `Dialog`, with its own compact rows (`TrackRow density="compact"` plus a checkbox slot).
- Liked songs warning: the shipped `components/ui/confirm-dialog.tsx` pattern, copy from `LikedWarning` in parts.tsx ("Adding songs to Liked songs likes every one of them..."), primary button "Like N songs" with N the songs not already liked.
- Result: `sonner` toast on desktop is too easy to miss for "skipped 3", so the result shows in the bar (or dialog) as in the candidate, with "Which?" listing each skip and why (`skipLine`), and "Open <destination>".
- Remove `components/library/options/playlist-copy/`, the `/dizajn` section, its `page.test.tsx` cases, `tests/playlist-copy-gallery-ui.test.mjs`, the `topBar` slot in ShellPreview if nothing else uses it, the icon exports nothing uses, and the `COLOUR_BASELINE` entry for `playlist-copy/parts.tsx`.
- Changelog: one user-visible entry (the feature queue note: an entry per user-visible merge).

## 5. Tests to write

Unit (vitest, `cd apps/web && npx vitest run <files>`):

- [ ] `lib/playlistCopy.test.ts`: the whole of today's `model.test.ts` (moved), plus a table test that every row of the section 1 table holds, and that `planCopy` never returns a song in both `add` and `skipped`.
- [ ] `app/api/playlists/[id]/tracks/bulk/route.test.ts` (same fake-PB style as `app/api/playlists/route.test.ts`): not signed in 401; someone else's playlist 404; empty or 501 tracks 400; adds in picked order at the next positions; skips same id, another version, picked twice; a unique-index 400 mid-loop counts as `same-track`; same-title different-artist is added.
- [ ] `app/api/likes/bulk/route.test.ts`: 401; no `confirmed` 400; skips a liked variant; artist-less same-title uploads are both liked; `liked_at` ordering puts the batch on top in picked order; `origin: 'user'`.
- [ ] `hooks/useTrackSelection.test.tsx`: toggle, select all, clear, the tri-state, selection survives a re-sort, drops ids that left the list.
- [ ] `hooks/useCollectionSort.test.tsx`: per-collection key, default per kind, storage off still sorts.
- [ ] `components/track/TrackRow.test.tsx` / `TrackList.test.tsx`: the select lead (or art select), `aria-checked`, the row toggles and still double-click plays outside select mode.
- [ ] `components/library/CollectionPage.test.tsx`: Select enters select mode, the bar shows the count, Copy to lists destinations without the source.
- [ ] Liked warning: nothing is liked before "Like N songs", Cancel likes nothing, N excludes songs already liked.
- [ ] `lib/lintRules.test.ts` stays green: tokens only, no raw colours, no `text-[`.

Browser (sandbox 3052/8087, `tests/playlist-copy-ui.test.mjs`, seeded through the API): make two playlists with an overlap that includes a variant and a same-title-different-artist song; select one by one, Select all, clear, sort by each key both ways; copy into the other playlist and check the result line and the destination's rows; copy into Liked songs, check the warning, Cancel (nothing liked), confirm (hearts on, Liked songs has the new ones on top, the variant not doubled, both "Home"s liked); a new playlist; at 390 and 1300, no horizontal overflow, the bar clear of the player bar and the Android inset. Screenshots with `SHOT_DIR` at deviceScaleFactor 1.

## 6. Order

1. `lib/playlistCopy.ts` + tests (move, no behaviour change).
2. `addedAt` on the two GET routes + `CollectionTrack`.
3. The two bulk routes + tests.
4. `lib/api.ts` + the two mutations.
5. `useTrackSelection`, `useCollectionSort` + tests.
6. The picked UI in `CollectionPage` / `TrackRow` (or the dialog) + tests.
7. Wire playlist, Liked, Uploads, Recently played pages.
8. Browser test, screenshots, clear `/dizajn`, changelog entry.
