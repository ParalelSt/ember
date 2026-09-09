# Deslop plan

Goal: make Ember's web UI a small set of reusable, presentational components
on top of shared tokens and pure functions, with unit tests for all of it,
and land the Library redesign (chosen in `docs/deslop/design-options.md`)
on that foundation. Builds on the `library-playlists` branch, which turns
Liked, Recently played and Uploads into collection pages; this plan never
re-implements that work, it wraps it.

Paths below are relative to `apps/web/` unless they start with `tests/`.

## a. Current state audit

Numbers come from the `deslop` worktree at commit 782a480.

Duplicated helpers

- Seconds to `m:ss` is written 6 times with 3 different empty values:
  `components/track/TrackList.tsx:16` and `components/player/QueueSheet.tsx:13`
  return `--:--`; `components/player/PlayerBar.tsx:34` and
  `components/player/NowPlaying.tsx:24` return `0:00`;
  `components/track/TrackPageClient.tsx:13` returns `''`;
  `app/(app)/album/[id]/page.tsx:13` (`fmtTotal`) adds an `h` form. Plus
  `formatBytes` at `app/(app)/settings/downloads/page.tsx:10` and `agoLabel`
  at `components/FriendsListening.tsx:11`.
- Fisher-Yates shuffle twice: `app/(app)/playlist/[id]/page.tsx:190` and
  `stores/usePlayerStore.ts:102`.
- Inline `n === 1 ? 'track' : 'tracks'` pluralising: 6 sites.
- Thumbnail pick `thumbnails[thumbnails.length - 1]?.url`: artist, album,
  AlbumCard.

Duplicated markup

- Hero header (cover, eyebrow, h1, meta) copied in 4 files: playlist, album,
  artist pages and `TrackPageClient`. The round ember Play button class string
  (`rounded-full bg-ember hover:bg-ember-soft text-white shadow-glow`) appears
  5 times.
- Page title classes in 7 files, section title classes in 13, eyebrow classes
  in 15, the centred "Loading… / not found / empty" div in 12 files (26 uses).
- Four hand-built "artwork + title + artist + trailing" rows: `TrackList`,
  `QueueSheet.Row`, search recents (`app/(app)/search/page.tsx:72`),
  `TrackSearchPicker`. Five "square art + title + subtitle" cards:
  `TrackCard`, `AlbumCard`, `FriendsListening`, and the playlist card twice
  inside `app/(app)/library/page.tsx` (online and offline branches).
- `components/nav/Sidebar.tsx` (131 lines) and `components/nav/Drawer.tsx`
  (145 lines): `BASE_NAV` is byte-identical, `handleCreate` differs by one
  `close()` call.
- Scrub state (`scrubPct`, `displayPct`, `onSliderChange`, `onSliderCommit`)
  duplicated in `PlayerBar` and `NowPlaying`; the like toggle
  (`findLikedVariant` + `toggleLike.mutate`) in `TrackList`, `PlayerBar`,
  `NowPlaying`.
- The offline guard (`useOnline()` then `return <OfflinePlaceholder />`) is
  repeated in 5 page-level files.

Coupling

- 11 components call `usePlayer()` and 12 import `hooks/useLibrary`; there is
  no presentational layer. `TrackList` fetches likes and auth itself, so it
  cannot render in a test without a QueryClient, an AuthProvider and a
  PlayerProvider.
- `app/(app)/playlist/[id]/page.tsx` is 315 lines and mixes fetching, offline
  pinning and staleness, shuffle-play logic, artwork upload, two confirm
  dialogs and all layout. `app/(app)/library/page.tsx` (155 lines) owns four
  dialogs' open state and two copies of the playlist grid.
- `components/player/PlayerProvider.tsx` is 646 lines: backend selection and
  fallback, position persistence, radio extend (about 50 lines of pure
  ranking inline at 380 to 430), loop and next/prev rules, keyboard
  shortcuts, Discord, remote commands, `playTrack`. Only `chooseDuration` and
  `resumePosition` are extracted and tested.
- `components/track/TrackRow.tsx` is not a row; it is a shelf of `TrackCard`s
  with a JS breakpoint table (`useResponsiveRowCount`) that must be kept in
  sync with a Tailwind class string by hand.

Styles

- `app/globals.css` (158 lines) defines colour tokens and radii only. There
  are no size tokens: 26 hard-coded `h-N w-N` artwork pairs, 44 arbitrary
  value classes, raw `oklch(...)` inside JSX in 4 files for the placeholder
  cover gradient. Type scale lives as repeated Tailwind strings.
- 103 `md:` usages: `md` is the real phone/desktop line and should be the
  only semantic breakpoint besides grid column steps.

Tests

- 20 scripts in `tests/` run against the sandbox or a browser. The single
  pure-logic test, `tests/duration.test.mjs`, strips TypeScript with regexes
  to import a `.ts` file. That hack is the clearest sign a unit layer is
  missing. There are no component tests.

## b. Target architecture

### Component library

`components/ui/` keeps the 16 shadcn/base-ui primitives untouched. New
folders hold Ember's own presentational components; each takes props and
callbacks only, imports nothing from `hooks/`, `stores/` or
`components/player/PlayerProvider`.

| Component | Location | Props (essentials) |
| --- | --- | --- |
| `Artwork` | `components/primitives/Artwork.tsx` | `src`, `alt`, `size: 'xs'|'sm'|'md'|'lg'|'xl'`, `shape: 'square'|'round'`, `fallback: 'music'|'gradient'|ReactNode`, `icon?` |
| `PlayButton` | `components/primitives/PlayButton.tsx` | `playing`, `size: 'sm'|'md'|'lg'`, `tone: 'ember'|'foreground'`, `onClick`, `label` |
| `LikeButton` | `components/primitives/LikeButton.tsx` | `liked`, `onToggle`, `size` |
| `PageTitle` | `components/page/PageTitle.tsx` | `children`, `actions?` |
| `SectionHeader` | `components/page/SectionHeader.tsx` | `title`, `action?: {label, href}` |
| `Eyebrow` | `components/page/Eyebrow.tsx` | `children` |
| `EmptyState` | `components/page/EmptyState.tsx` | `kind: 'empty'|'loading'|'error'`, `message`, `link?` |
| `CollectionHeader` | `components/page/CollectionHeader.tsx` | `eyebrow`, `title`, `meta: string[]`, `art: ArtworkProps`, `onArtClick?`, `children` (action row) |
| `ActionBar` | `components/page/ActionBar.tsx` | `children`; sticky variant via `sticky` |
| `TrackRow` | `components/track/TrackRow.tsx` | `track`, `index?`, `showRank`, `showAlbum`, `showDuration`, `active`, `playing`, `liked`, `onPlay`, `onToggle`, `onLike?`, `onRemove?`, `trailing?` (menu slot), `density: 'list'|'compact'` |
| `TrackList` | `components/track/TrackList.tsx` | `tracks`, row props above minus per-track ones, `currentId`, `isPlaying`, `likedIds: Set` |
| `TrackCard` | `components/track/TrackCard.tsx` | `track`, `active`, `playing`, `onActivate` |
| `TrackShelf` | `components/track/TrackShelf.tsx` (renamed from today's `TrackRow.tsx`) | `title`, `tracks`, `loading`, `showAllHref?`, `renderCard` |
| `CollectionCard` | `components/library/CollectionCard.tsx` | `title`, `subtitle`, `href`, `art`, `badge?: 'downloaded'`, `size: 'md'|'lg'` |
| `CollectionShelf` | `components/library/CollectionShelf.tsx` | `title`, `items: CollectionCardProps[]`, `showAllHref?`, `trailing?` (New playlist tile) |
| `NavLinks` | `components/nav/NavLinks.tsx` | `items`, `activePath`, `onNavigate?` |
| `CollectionNavList` | `components/nav/CollectionNavList.tsx` | `items: {label, href, icon?}[]` |
| `SeekBar` | `components/player/SeekBar.tsx` | `position`, `duration`, `onSeek`, `showLabels` (owns scrub state) |
| `TransportControls` | `components/player/TransportControls.tsx` | `playing`, `onToggle`, `onNext`, `onPrev`, `size`, `left?`, `right?` slots |
| `VolumeControl` | `components/player/VolumeControl.tsx` | `volume`, `muted`, `max`, `onChange`, `onToggleMute` |
| `NowPlayingSummary` | `components/player/NowPlayingSummary.tsx` | `track`, `onOpen?`, `artistLink` |

Data-aware pieces are hooks, not components:

- `hooks/useTrackActions.ts` returns `{ currentId, isPlaying, likedIds,
  onPlay(track, list, context), onToggle, onLike(track) }` by composing
  `usePlayer`, `useQueryLikes`, `useExecuteToggleLike`, `useAuth`. Pages
  spread it into `TrackList`. This is the one place the "like a variant"
  rule lives.
- `hooks/useCollections.ts` returns the system collections plus playlists as
  `CollectionSummary[]` (see `lib/collections.ts`), used by Library, Sidebar
  and Drawer.
- `hooks/useOfflinePin.ts` wraps download / cancel / remove / staleness for a
  collection id (moved out of the playlist page).
- `hooks/useOnlineGuard.ts` plus a `<OnlineOnly>` wrapper replaces the five
  copied early returns.

### Shared functions (`lib/`, framework-free, no React or Next imports)

- `lib/format.ts`: `formatTime(sec, { empty = '0:00' })`,
  `formatTotalDuration(sec)` (`1 h 12 min` / `3:10`), `formatBytes(n)`,
  `formatCount(n, 'song')` -> `'7 songs'`, `formatAgo(iso, now)`.
- `lib/shuffle.ts`: `shuffle(list, rng = Math.random)`; injected rng makes it
  testable. Used by the store and by "shuffle play".
- `lib/collections.ts`: `CollectionRef` (`{ kind: 'liked'|'history'|'uploads'
  |'playlist', id? }`), `hrefFor(ref)`, `toSummary(ref, tracks|count, meta)`,
  `systemCollections()` order and icons. This is the seam with
  `library-playlists`: whatever routes that branch chose are encoded once, in
  `hrefFor`.
- `lib/artwork.ts`: `pickThumbnail(thumbnails)`, `placeholderFor(ref)`.
- `lib/playback/radio.ts`: `rankRadioPool({ pool, queue, current, history,
  liked, context })` returning the merged list; the inline logic from
  PlayerProvider, unchanged behaviour.
- `lib/playback/queueNav.ts`: `nextIndex(state)`, `prevIndex(state,
  currentTime)`, `wrapPoint(state)`; pure versions of the loop rules.
- `lib/playback/shortcuts.ts`: `shortcutFor(event, state) -> Action | null`.

### Styles and tokens (`app/globals.css`)

- Sizes: `--spacing-art-xs: 2.5rem` (40), `-sm: 3rem` (48),
  `-md: 10rem` (160), `-lg: 12rem` (192), `-xl: 14rem` (224) inside
  `@theme`, so `size-art-md` is a utility. Every artwork goes through
  `Artwork` and these tokens; the 26 hand-written pairs disappear.
- Cover placeholder: `--cover-from: var(--ember)`, `--cover-to:
  oklch(0.3 0.15 25)` and a `.cover-placeholder` utility; no `oklch(` in
  JSX afterwards.
- Type: `@utility text-page-title`, `text-hero-title`, `text-section-title`,
  `text-eyebrow`, `text-meta` mapping to today's exact class strings.
- Layout: `--sidebar-w: 15rem`, `--lyrics-w: 28rem`, `--content-max: 80rem`;
  `.grid-cards` = `grid-template-columns: repeat(auto-fill, minmax(var(
  --card-min, 10rem), 1fr))`, replacing the JS breakpoint table. "One row
  only" shelves get the visible count from a single `SHELF_ROW_COUNT` map in
  `lib/layout.ts`, tested, instead of two strings kept in sync by hand.
- Spacing stays on Tailwind's default 4px scale; the 8px rhythm is enforced
  by using only even steps (`gap-2/4/6/8`, `p-4/6/8`) and a lint test.

### Decoupling rules

1. Pages (`app/**/page.tsx`) fetch through `hooks/`, own dialog open state,
   and compose components. A page has no markup beyond layout wrappers.
2. `components/{primitives,page,track,library,nav}` are presentational:
   props in, callbacks out. They never import `hooks/*`, `stores/*`,
   `@tanstack/react-query` or `PlayerProvider`. Enforced by
   `no-restricted-imports` in `eslint.config.mjs`.
3. `components/player/*` may read the player, ui and settings stores; nothing
   else reads stores except pages and hooks.
4. Stores hold cross-page state only (queue, playback, ui flags, settings,
   offline). Dialog open flags and scrub state are local.
5. `lib/` has no React and no Next imports; every exported function has a
   unit test.
6. `PlayerProvider` becomes a composition root of hooks with the same
   `PlayerControls` contract; consumers do not change.

## c. Layout redesign

Three directions are drawn in `docs/deslop/design-options.md`. Recommended:
Option 2, Shelves, with two borrows: the three system collections listed at
the top of the sidebar's playlist list (from Option 1) and icon covers for
those collections (from Option 3). Reasons: its few-items state is its
designed state (a shelf of three large cards is complete, not sparse); it
reuses Home's shelf grammar so Library adds no layout code of its own; and it
leaves the desktop shell (sidebar width, LyricsPanel column, player bar)
alone. The collection page in that option (compact header, inline actions,
sticky action bar on scroll) is `CollectionHeader` + `ActionBar` + `TrackList`
and is shared by playlists, the three system collections, and albums.

## d. Test strategy

Runner: Vitest with `@testing-library/react`, `@testing-library/user-event`
and `happy-dom`, configured in `apps/web/vitest.config.ts` (about 15 lines:
`@vitejs/plugin-react`, `resolve.alias['@'] = '.'`, `environment:
'happy-dom'`, `include: ['**/*.test.{ts,tsx}']`). Why: it compiles TS/TSX
with no build step and resolves the `@/` alias, it supports React 19 (RTL
16), tests run in milliseconds with no server, and it removes the
regex-strip hack in `tests/duration.test.mjs`. Why not Node's runner alone:
Node 24 strips types natively but cannot resolve `@/` without a loader and
cannot render components; two runners would need two sets of docs. Why not
Jest: needs a transformer and ESM shims for this stack. Fallback if new
devDependencies are refused: `node --test` for `lib/` only, with `lib/`
restricted to relative imports.

Layers

- Unit (Vitest, `apps/web/**/*.test.ts(x)`, colocated): every `lib/`
  function; store actions via `useXStore.getState()`; every presentational
  component (render with props, assert text and aria, fire callbacks);
  hooks with `renderHook` inside a `QueryClientProvider` and `vi.mock('@/lib/
  api')`. Runs with `npm run test:unit` from the repo root, no sandbox.
- Sandbox scripts (`tests/*.test.mjs`, unchanged): API behaviour, auth,
  streams, uploads.
- Browser (Playwright, `tests/*-ui.test.mjs`): real playback, offline OPFS,
  and one smoke per redesigned page: Library shows the three collection
  cards and the playlists shelf; a collection page's Play starts audio.

Rules: a migration step is not done until its unit tests pass, `npm run lint`
and `tsc --noEmit` pass, and the sandbox scripts that guard the touched area
are green. `tests/README.md` gains a "Unit tests" section at the top saying
these need no sandbox.

## e. Migration plan

Ordered, each independently mergeable to the feature branch, each sized for
one night of autonomous work. Behaviour never changes inside a step unless
the step says so.

0. Unit harness. Add Vitest config, `test:unit` scripts, and first tests for
   `chooseDuration`, `resumePosition`, `songKey`, `usePlayerStore`
   (`toggleShuffle`, `cycleLoopMode`, `toggleMuted`). Port
   `tests/duration.test.mjs` cases; keep the old file until step 9.
   Risk: low.
1. `lib/format.ts`, `lib/shuffle.ts`, `lib/artwork.ts`. Replace the 6 time
   formatters (pass `empty` to keep `--:--` where it was), `fmtTotal`,
   `formatBytes`, `agoLabel`, both shuffles, the 6 pluralisers, the 3
   thumbnail picks. Tests: full coverage of the three files. Risk: low.
2. Tokens and utilities in `globals.css`; replace raw `oklch(` in JSX,
   arbitrary sizes, and repeated type strings. Add `lib/layout.ts`. Tests: a
   Vitest "lint test" that scans `components/` and `app/` for banned
   patterns (`oklch(` in tsx, `to-[`, `h-44 w-44`). Risk: low to medium
   (visual drift); do a screenshot pass on phone and desktop before merge.
3. `components/primitives` and `components/page`: `Artwork`, `PlayButton`,
   `LikeButton`, `PageTitle`, `SectionHeader`, `Eyebrow`, `EmptyState`,
   `CollectionHeader`, `ActionBar`, `<OnlineOnly>`. Adopt in playlist, album,
   artist, track pages and the 5 offline guards. Tests: RTL for each. Risk:
   medium; the playlist page moves markup only, all handlers stay.
4. Track layer: pure `TrackRow`, `TrackList`, `TrackCard`, rename to
   `TrackShelf`, `hooks/useTrackActions.ts`. `QueueSheet`, search recents and
   `TrackSearchPicker` render `TrackRow` with `density="compact"`. Tests:
   `TrackRow` states (rank, active, playing, liked, remove, album hidden),
   `TrackList` empty state, `useTrackActions` variant-like rule. Risk:
   medium (double-click play, artist link `stopPropagation`, search recents
   remove button). Browser: `tests/tabs-ui` and `uploads-ui` stay green.
5. Library on `library-playlists`: `lib/collections.ts`, `hooks/
   useCollections.ts`, `CollectionCard`, `CollectionShelf`, the new
   `app/(app)/library/page.tsx` (shelves per design option 2), `NavLinks` +
   `CollectionNavList` replacing the duplicated halves of Sidebar and
   Drawer, system collections above playlists in both. Tests: descriptor
   logic (order, subtitles, `hrefFor`), `CollectionCard`, Library page with
   mocked hooks (3 cards, empty playlists shows the New playlist tile,
   offline shows downloaded only). Browser: new `tests/library-ui.test.mjs`.
   Depends on `library-playlists` being merged first. Risk: medium.
6. Player components: `SeekBar`, `TransportControls`, `VolumeControl`,
   `NowPlayingSummary`; `PlayerBar` and `NowPlaying` compose them; `hooks/
   useLikeToggle.ts` shared by both and `TrackList`. No backend or provider
   changes. Tests: `SeekBar` (thumb follows drag, seek fires once on
   release), `TransportControls` aria labels, `VolumeControl` mute state.
   Risk: medium to high on phones; verify the bare `<audio>` path and the
   full-screen overlay by hand on Android before merge.
7a. Pure extractions from `PlayerProvider`: `lib/playback/radio.ts`,
   `queueNav.ts`, `shortcuts.ts`, wired back in with identical behaviour.
   Tests: radio ranking (front-load 2, 1-in-3 weave, artist drift, variant
   blocking), loop wrap rules, shortcut map. Risk: medium; `tests/
   resume-position` and `playback-position` must stay green.
7b. Provider hooks: `hooks/player/usePositionPersistence.ts`,
   `useRadioExtend.ts`, `useKeyboardShortcuts.ts`, `useRemoteCommands.ts`,
   `useDiscordPresence.ts`; `PlayerProvider` shrinks to backend ownership +
   `playTrack`/`next`/`prev`/`toggle`. Tests: each hook with `renderHook` and
   a fake backend. Risk: high; separate night, sandbox suite fully green,
   manual desktop and Android check.
8. Home and Search on the new layer: `TrackShelf` uses `.grid-cards` and
   `lib/layout.ts`; `FriendsListening` uses `TrackCard`; search recents use
   `TrackRow`. Tests: shelf visible-count logic, Search page with mocked
   queries (rate-limit message, recents remove). Risk: low.
9. Cleanup and guard rails: delete leftover helpers and the old
   `duration.test.mjs`, add the `no-restricted-imports` rule, update
   `README.md` layout tree and `tests/README.md`. Risk: low.

Steps 1, 2 and 3 can run in parallel worktrees; 4 needs 3; 5 needs 4 and
`library-playlists`; 6 needs 3; 7a and 7b need 1; 8 needs 4.

## f. Out of scope

Audio backends, native shells (Capacitor, Tauri), offline OPFS internals,
API routes and PocketBase schema, lyrics and tabs internals, admin pages
(they may adopt the primitives later), session pages, light theme, drag to
reorder, and any feature not required by the chosen layout.
