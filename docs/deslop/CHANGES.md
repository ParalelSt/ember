# Deslop changes

What each step of `docs/DESLOP.md`'s migration plan rewrote or simplified,
on branch `deslop`. Behaviour is unchanged unless a line says otherwise.
Every step ran the unit suite, lint, tsc and the browser suites that guard
the touched area. Source: the step reports and
`.superpowers/sdd/deslop/summary.md`, which the controller maintained
through the plan.

## Step 0: unit test harness

- Vitest, Testing Library and happy-dom added to `apps/web` (`npm run
  test:unit`, no sandbox needed). Tests live next to the code as
  `*.test.ts(x)`.
- First tests: `chooseDuration` (ported from `tests/duration.test.mjs`),
  `resumePosition`, `songKey`, `usePlayerStore` (`toggleShuffle`,
  `cycleLoopMode`, `toggleMuted`).

## Step 1: shared helpers (`lib/`, framework-free, fully unit-tested)

- `lib/format.ts`: `formatTime` replaced six copies of the m:ss formatter
  (`TrackList`, `QueueSheet`, `PlayerBar`, `NowPlaying`, `TrackPageClient`,
  `UploadTrackDialog`); `formatTotalDuration` (album page), `formatBytes`
  (Settings > Downloads), `formatCount` (seven inline pluralisers in
  dialogs, sidebar, drawer, downloads; `countLabel` in `lib/collections`
  delegates to it), `formatAgo` (`FriendsListening`).
- `lib/shuffle.ts`: one Fisher-Yates with an injectable rng, used by the
  player store and shuffle play.
- `lib/artwork.ts`: `pickThumbnail` replaced the "last thumbnail" pick in
  album, artist and `AlbumCard`.
- Deliberate tiny fix: the upload dialog's duration preview floors seconds
  (the old rounding could print 1:60).

## Step 2: design tokens and layout table

- `globals.css`: artwork size tokens (`size-art-xs..xl`), cover gradient as
  `cover-placeholder` (no raw `oklch` in JSX), type utilities
  `text-page-title`, `text-hero-title`, `text-section-title`,
  `text-eyebrow`, `text-meta` replacing the repeated class strings, layout
  tokens for sidebar width and content max width, and (until step 9) a
  `grid-cards` utility defined for later steps.
- `lib/layout.ts`: `SHELF_ROW_COUNT`, `gridColsClass`, `visibleCount`
  replace `TrackRow`'s two class-string literals and its hand-kept
  breakpoint table.
- `lib/lintRules.test.ts`: a unit test that scans `app/` and `components/`
  and fails on banned patterns (raw `oklch`, `to-[`, the replaced type
  strings, the old `h-44`/`h-48` artwork pairs).

## Step 3: primitives (props in, callbacks out, no store or hook imports)

- `components/primitives/Artwork` (10 sites: `TrackList`, `TrackCard`,
  `QueueSheet`, `PlayerBar`, `NowPlaying`, `TrackSearchPicker`,
  `AlbumCard`, `CollectionCover`, `LyricsBody` and the hero covers),
  `PlayButton` (album, artist, track page, `CollectionPage`, `TrackCard`),
  `LikeButton` (`TrackList`, `PlayerBar`, `NowPlaying`; the like logic
  stayed in place for step 6).
- `components/page/PageTitle` (7 pages), `SectionHeader` (15 sites),
  `Eyebrow`, `EmptyState` (32 centred loading/empty/error blocks in 15
  files).
- Album, artist and track pages render the shared `CollectionHeader`
  (three cover-size variants, two hero tokens added) instead of copied
  hero markup.
- `OfflineGate` renamed `OnlineOnly` and used at the five offline guards
  (home, search, album, artist, track page). Side effect: those pages no
  longer fire their query while offline.
- Harness: React 19 aliasing added to `vitest.config.ts` so components
  render under the right React.
- One visual nuance: `TrackCard`'s play button now has the shared hover
  shade and focus ring.
- Unit tests after step 3: 117.

## Step 4: the track layer

- `components/track/TrackShelf.tsx` (renamed from the old `TrackRow`
  shelf) with a pure `TrackCard` (no player hook inside; callers pass
  `onActivate`).
- New pure `components/track/TrackRow.tsx`: one track line with
  `density="list"` (rank, album, duration, like, remove, trailing menu) or
  `density="compact"`; replaced the four hand-built rows in `TrackList`,
  `QueueSheet`, search recents and `TrackSearchPicker`.
- Pure `components/track/TrackList.tsx`: props in (tracks, currentId,
  isPlaying, likedIds, callbacks), no data fetching inside.
- `hooks/useTrackActions.ts`: the one place composing the player, likes,
  the like mutation and auth; the "a liked variant counts as liked" rule
  lives only here. Pages spread it into `TrackList`.
- Byproduct of sharing one row: compact titles use one weight
  (`font-medium`). Two additions the review caught were reverted: search
  recents do not highlight the current song, and artless queue rows keep
  their empty box.
- 45 new unit tests (`TrackRow` states, `TrackList` empty state and
  callbacks, `TrackCard`, `TrackShelf` visible count, `useTrackActions`
  variant rule). Unit tests after step 4: 162.

## Step 5: Library and navigation

- `hooks/useCollections.ts` plus a pure `toSummary` in `lib/collections.ts`:
  the Library page builds its two shelves from one hook instead of
  composing four queries inline.
- `components/nav/NavLinks.tsx` (top nav, `BASE_NAV` defined once) and
  `PlaylistNavList`: `Sidebar` and `Drawer` render the same pieces instead
  of two copies.
- `hooks/useCreatePlaylistFlow.ts`: the create-playlist dialog state and
  handler that both `Sidebar` and `Drawer` duplicated (`Drawer` just
  closes afterwards).
- Unit tests after step 5: 179.

## Step 6: player components

- `components/player/SeekBar.tsx` (owns the scrub state: thumb follows the
  drag, seek fires once on release), `TransportControls.tsx` (Previous,
  Play/Pause, Next with slots for shuffle and loop), `VolumeControl.tsx`
  (mute button and slider), `NowPlayingSummary.tsx` (artwork, title,
  artist).
- `hooks/useLikeToggle.ts`: the like toggle for the player bar and the
  overlay; the "liked variant" rule is one shared helper used by it and by
  `useTrackActions`.
- `PlayerBar` and `NowPlaying` compose those pieces (from 296 lines each
  to 184 and 251); the duplicated scrub, like and transport code is gone.
  No `PlayerProvider` or backend change.
- Unit tests after step 6: 207. Player bar screenshots byte-identical
  before and after.

## Step 7a: pure playback rules out of PlayerProvider

- `lib/playback/queueNav.ts`: loop wrap point and the next/prev index
  rules (playlist wraps at the playlist end, not the radio tail; first
  track plus loop-all wraps to the last; over three seconds restarts).
- `lib/playback/radio.ts`: `rankRadioPool`, the radio-extend ranking
  (front-load two, one-in-three weave, artist drift cap, blocking by
  current track and queue).
- `lib/playback/shortcuts.ts`: `shortcutFor`, the keyboard map (Space, M,
  arrows) with the typing-target guard.
- `PlayerProvider` calls them (679 to 618 lines); 55 new unit tests pin
  every rule. Unit tests after step 7a: 262.

## Step 8: Home and Search

- `FriendsListening` renders the shared `TrackCard` instead of its own
  card markup (the listener name and "ago" label become the subtitle;
  artless cards keep their music icon).
- Search: recents and results are fully on `TrackRow`/`TrackList` with
  `useTrackActions`; the rate-limit message and the remove button keep
  their text.
- `TrackShelf` keeps its `lib/layout.ts` column table: the plan's CSS
  auto-fill grid cannot reproduce the column counts because the sidebar
  appears at the `md` breakpoint and shrinks the content width there. The
  unused `grid-cards` utility was removed in the cleanup step (step 9).
- Unit tests after step 8: 278.

## Step 7b: PlayerProvider as a composition root

- Five hooks under `hooks/player/`: `useKeyboardShortcuts`,
  `useDiscordPresence`, `useRemoteCommands` (media session and remote
  commands for the Capacitor, Android and Tauri shells), `useRadioExtend`
  (the radio-extend effect around `rankRadioPool`), `usePositionPersistence`
  (stored playhead per track, resume on load).
- `PlayerProvider` keeps backend creation and swap, `loadAndPlay`,
  `playTrack`, next/prev/toggle and the context value: 679 lines at the
  start of the plan, 431 now. The `usePlayer()` contract and every
  consumer are unchanged.
- 54 new hook tests with fake backends. Unit tests after step 7b: 334.

## Step 9: cleanup and guard rails

- Deleted `tests/duration.test.mjs` and its `test:duration` script; every
  case it covered has lived in `apps/web/lib/playback/chooseDuration.test.ts`
  since step 0.
- Checked `app/` and `components/` for leftover local copies of what
  `lib/format.ts`, `lib/shuffle.ts`, `lib/artwork.ts`, `lib/layout.ts` and
  `lib/collections.ts` now provide. None found beyond the ones already
  routed through the libs in steps 1 to 8; `tsc --noEmit` was already
  clean going in.
- Added `no-restricted-imports` in `apps/web/eslint.config.mjs`: files
  directly under `components/{primitives,page,track,library,nav}/` may
  not import `@/hooks/*`, `@/stores/*`, `@tanstack/react-query` or
  `@/components/player/PlayerProvider`. The rule only matches direct
  children of those folders, so a genuinely data-aware file can opt out by
  moving one level deeper. `lib/**` got the mirror rule: no `react`,
  `next/*` or `@/components/*` imports.
- Moved the data-aware track subcomponents into
  `components/track/menus/`, out from under the new restriction, updating
  every caller: `TrackMenu.tsx`, `AddToPlaylistMenu.tsx`,
  `CreatePlaylistDialog.tsx`, `ImportPlaylistDialog.tsx`,
  `TrackSearchPicker.tsx`, `UploadTrackDialog.tsx`.
- Listed three composition roots as explicit eslint overrides rather than
  moving them, since moving would only relocate the same composition root:
  `components/nav/Sidebar.tsx` and `components/nav/Drawer.tsx` (own the
  playlists query and the create-playlist flow, the same way `PlayerBar`
  owns player state), and `components/track/TrackPageClient.tsx` (the
  track detail page's client half, not a reusable row or card).
- Listed four pre-existing `lib/` files as explicit overrides on the
  `lib/**` rule, since they predate this plan and are out of its scope:
  `lib/useBackDismiss.ts`, `lib/useOnline.ts`, `lib/offlineNative.ts`
  (hook-shaped, import React) and `lib/pocketbase/server.ts`
  (server-only, imports `next/headers`).
- `npm run lint` still shows the same 9 pre-existing errors and 5
  pre-existing warnings; the new rule adds none.
- Checked the odd-spacing lint rule the step 2 report deferred (`gap-1 `,
  `gap-3 `, `gap-5 `, `p-3 `, `p-5 `): counts are still nonzero (12, 26, 0,
  30, 2), so per the step 2 report's own instruction the rule stays out.
- Moved `apps/web/hooks/player/fakeBackend.ts` (imports `vitest`) to
  `apps/web/test-utils/fakeBackend.ts`, out of the production tree, and
  updated the five hook tests that import it
  (`usePositionPersistence.test.ts`, `useRadioExtend.test.ts`,
  `useDiscordPresence.test.ts`, `useRemoteCommands.test.ts`,
  `useKeyboardShortcuts.test.ts`).
- Added `components/player/PlayerProvider.test.tsx`: renders
  `PlayerProvider` with a mocked backend factory (the shared fake backend
  from `test-utils/`), calls `playTrack` through `usePlayer()`, and
  asserts the backend's `load`/`play` are called once, that
  `usePositionPersistence`'s `startAt` path resets the position for a
  track that does not own the stored playhead, and that a backend
  `onPause` event persists the position. Three cases.
- Deleted the unused `.grid-cards` utility from `globals.css` (step 8 kept
  `TrackShelf`'s `gridColsClass` table instead; see step 8 above) and its
  mentions in `docs/DESLOP.md`.
- Updated `README.md`'s layout tree with `components/primitives`,
  `components/page`, `components/library`, `components/nav`,
  `lib/format.ts`, `lib/shuffle.ts`, `lib/artwork.ts`, `lib/layout.ts`,
  `lib/collections.ts`, `lib/playback/{queueNav,radio,shortcuts}.ts`, and
  a `hooks/` block listing `useTrackActions`, `useLikeToggle`,
  `useCollections`, `useOfflinePin`, `useCollectionPlayback`,
  `useCreatePlaylistFlow` and `hooks/player/`.
- Updated `tests/README.md`'s "Unit tests" section with the test folder
  list and the two guard-rail rules (import boundaries, style lint).
- Added a "Status" block at the top of `docs/DESLOP.md`: commit ranges per
  step, what was deferred, and the follow-ups collected from the step
  reports.
- Unit tests after step 9: 351 (the final-review fix wave added tests for lib/nav and the collection descriptors).