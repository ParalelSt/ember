# Ember design system pass

A plan, not code. It builds on the deslop refactor (`docs/DESLOP.md`,
`docs/deslop/CHANGES.md`): the helpers in `lib/`, the tokens and type
utilities in `app/globals.css`, the presentational components under
`components/{primitives,page,track,library,nav}` and the style lint in
`lib/lintRules.test.ts` all stay and get extended. Nothing here changes
behaviour: what a click does, what a row shows, what a page fetches. Paths
are relative to `apps/web/` unless they start with `docs/` or `tests/`.

How approval works: every stage adds a section to `/dizajn`
(`app/(app)/dizajn/page.tsx`) that renders the real components from mock
data, with a picker where there is a real choice. The owner answers with an
option name. A stage lands in two commits: candidates on `/dizajn`, then the
winner set as the default and the loser deleted.

## 1. What is wrong today

### Vertical rhythm on collection pages

The Liked page (`app/(app)/library/liked/page.tsx`) renders
`components/library/CollectionPage.tsx`, which puts the `ActionBar` inside
`CollectionHeader`'s text column (`CollectionPage.tsx:79-112`). The spacing
that results, top to bottom on a phone:

| Gap | Today | Where it comes from |
| --- | --- | --- |
| cover to eyebrow | 24 | `gap-6` on the header flex, `CollectionHeader.tsx:54` |
| eyebrow to title | 8 | `mt-2` baked into the `text-hero-title` utility, `globals.css:124` |
| title to "10 songs" | 12 | `mt-3` on the meta line, `CollectionHeader.tsx:81` |
| "10 songs" to Play | 0 | children rendered straight after meta, `CollectionHeader.tsx:91`; `ActionBar` has no top margin, `ActionBar.tsx:6` |
| Play to first row | 48 | `mb-6` on `ActionBar` plus `mb-6` on the header, `ActionBar.tsx:6`, `CollectionHeader.tsx:54` |

Zero above the buttons and 48 below them is the "text is too close". The
album page does it differently: header `mb-6`, then its own
`flex items-center gap-3 mb-6` row (`app/(app)/album/[id]/page.tsx:58-66`),
so meta to Play is 24 and Play to list is 24. The artist page adds a
description with `mt-3` (`app/(app)/artist/[id]/page.tsx:54`), its own Play
row (`:58`), then `SectionHeader className="mb-3"` (`:66`), a scroll box with
`mb-8` (`:67`) and `className="mb-3 mt-8"` (`:86`). The track page copies the
album pattern (`components/track/TrackPageClient.tsx:64`). Four pages, three
rhythms. `CollectionSkeleton.tsx:26-40` hardcodes the header geometry a
second time (`gap-6 mb-6`, `gap-3`, `py-2`), so it drifts the moment the
header moves.

There is no spacing scale: `globals.css:10` promises an "8px spacing
rhythm" but the only spacing tokens are the artwork sizes (`:57-66`).
Counting `app/` and `components/` (tests excluded): `gap-3` 42 uses,
`gap-2` 37, `py-2` 29, `gap-4` 25, `gap-1` 25, `gap-1.5` 24, `mb-6` 22,
`mt-6` 18, `mt-1` 18, `mt-2` 15, `mb-4` 15, `mb-3` 15, `py-3` 13, `mt-3` 12,
`mt-4` 10. `PageTitle` takes its margin from each page (`mb-8` on home,
`mb-6` on settings, admin and search, `mb-2` on library offline, none on
library online, `truncate` on session), which `PageTitle.tsx:5` documents
as intended.

### Alignment in the track list

`components/track/TrackRow.tsx:208` lays a list row out as
`grid-cols-[40px_minmax(0,1fr)_auto]` on phones and
`[40px_minmax(0,1fr)_minmax(0,1fr)_60px_auto]` on desktop, `gap-3 px-3 py-2`.

- Title and album are both `1fr`; the trailing column is `auto`, so its
  width is whatever controls that row happens to have. `ShareButton.tsx:40`
  returns null for non-YouTube tracks, `menus/TrackMenu.tsx:18` drops Add
  for unavailable tracks, `TrackRow.tsx:163` adds Replace only on
  unavailable rows. In a mixed list (Uploads, or Liked with an upload) the
  album column line moves by 16px per missing or extra 32px control.
- With `showAlbum={false}` (album page) the empty album cell still takes
  `1fr` (`TrackRow.tsx:264-266`): titles get half the row for nothing.
- A track with no art and no fallback gets no art box at all
  (`TrackRow.tsx:69-72`, `:128-140`); `CollectionPage` passes no fallback, so
  artless rows start their title 52px further left.
- The duration is `text-sm` in a 60px cell (`:267`) next to a `gap-1`
  cluster of 32px buttons (`:269`), while compact rows use a `text-xs`
  duration (`:195`) and a 28px remove button (`:149`) against 32px in list
  rows (`:150`).
- Compact rows (`:176-200`) are a flex row with no lead column, so their
  art sits at x=12 while list rows' art sits at x=64. The search overlay
  stacks both (`components/search/SearchOverlayContainer.tsx:46-74`): recents
  and results do not line up. The picker overrides the padding to
  `px-2 py-1.5` (`menus/TrackSearchPicker.tsx:136`).
- Two track rows live outside `TrackRow`: the admin one
  (`app/(app)/admin/tracks/page.tsx:104`, grid at `:133`) and the session
  queue rows (`app/(app)/session/[id]/page.tsx:116-131`, a `w-6` rank).

### Consistency across page shapes

| Page | Header block | Space before first content | Section gaps |
| --- | --- | --- | --- |
| Liked, Recent, Uploads, playlist | `CollectionHeader` + inline `ActionBar` | 48 | `mt-10` before Add songs (`playlist/[id]/page.tsx:163`) |
| Album, track | `CollectionHeader` + hand-rolled row | 24 | none |
| Artist | `CollectionHeader` + description + hand-rolled row | 24 | `mb-8`, `mt-8`, `mb-3` mixed |
| Home | `PageTitle mb-8` (`page.tsx:103`) | 32 | `mb-10` per shelf, raw `h2` with `mb-4` in `FriendsListening.tsx:31`, `mb-3` in `TrackShelf.tsx:91` |
| Search | `pt-4 md:pt-0` (`search/page.tsx:70`, also `search/loading.tsx:9`, `session/[id]/page.tsx:135`), `PageTitle mb-6` | 24 (40 on phones) | `mt-8 max-w-xl`, `mt-8 mb-4` |
| Library | `mb-6 flex justify-between` (`library/page.tsx:64`) | 24 | `mb-10`, raw `h2` with `mb-3` in `CollectionShelf.tsx:17` |
| Settings, admin | `PageTitle mb-6`, `gap-6 md:gap-10` (`settings/layout.tsx:8-9`, `admin/layout.tsx:17-18`) | 24 | `mt-6` cards (`settings/help/page.tsx:16`), `space-y-6` (`downloads/page.tsx:67`) |

Empty and loading states: `EmptyState` (`py-12`, 35 uses) next to
hand-rolled `py-6 text-center` (`TrackSearchPicker.tsx:115,118`,
`session/[id]/page.tsx:163`), `py-8` (`QueueSheet.tsx:79`), `py-10`
(`CreatePlaylistDialog.tsx`). "Loading…" text appears in 17 files; only the
routes with a `loading.tsx` show a skeleton.

Type outside the utilities: 23 `text-[10px]`/`text-[11px]` uppercase
labels (`Sidebar.tsx:55`, `Drawer.tsx:74`, `QueueSheet.tsx:39,57`,
`TrackSearchPicker.tsx:87`, `CreatePlaylistDialog.tsx:84`, `SeekBar.tsx:59-70`,
`MobileNav.tsx:40`, settings plugins, session, `BugReportDialog`,
`TabsDialog`); the raw section-title string plus a margin at six sites
(`CollectionShelf.tsx:17`, `FriendsListening.tsx:31`, the four
`library/options/*`), which slip past the lint because it only bans the
exact string (`lintRules.test.ts:55-71`).

### Density and touch targets

- Row controls are 32px on phones: play cell `TrackRow.tsx:223`, remove
  `:150`, `LikeButton` sm (`LikeButton.tsx:8`), the Add trigger
  (`menus/AddToPlaylistMenu.tsx:71`), `ShareButton.tsx:82`. Compact
  remove is 28px (`TrackRow.tsx:149`). On a 390px phone a Liked row spends
  52 on the lead cell, 116 on menu + share + like, 52 on art and gaps, and
  leaves about 98px for the title.
- `PlayerBar.tsx:86` is `px-4 pt-3 pb-2`; only the queue button has a phone
  size (`h-10 w-10 md:h-8 md:w-8`, `:156`). `TopBar.tsx:10-17` balances a
  32px menu button against a `w-9` (36px) spacer, so the wordmark is 2px
  off centre. `NowPlaying.tsx:207-211` mixes a 40px like and share with a
  32px Add trigger (`menus/AddToPlaylistMenu.tsx:71`) in one cluster. `MobileNav.tsx:40` and the sidebar rows
  (`NavLinks.tsx:47`, 36px) are fine for their inputs.

## 2. The spacing scale

Tokens go in `@theme` as `--spacing-*`, the same mechanism the art sizes
use (`globals.css:54-66`), so Tailwind generates `gap-stack`, `mb-section`,
`px-row`, `py-row`, `size-hit` and so on. Six steps plus the page gutter.

| Token | px | Utilities | Role | Replaces today |
| --- | --- | --- | --- | --- |
| `inset` | 4 | `gap-inset`, `px-inset` | icon to label inside a control; chip padding; controls in an actions cluster | `gap-1`, `mt-1`, `mb-1`, `gap-1.5`, `py-0.5` |
| `cluster` | 8 | `gap-cluster`, `mt-cluster` | eyebrow to title, title to meta; buttons in an action bar; desktop row vertical padding | `gap-2`, `mt-2`, `mb-2`, `py-2` |
| `row` | 12 | `gap-row`, `px-row`, `py-row` | inside a row or card: art to text, row padding, grid column gap; phone row vertical padding; phone card grid gap | `gap-3`, `px-3`, `py-3`, `mt-3`, `mb-3` |
| `block` | 16 | `mb-block`, `gap-block` | a heading to its content (section title to list, description under a title); desktop card grid gap | `mb-4`, `mt-4`, `gap-4` |
| `stack` | 24 | `mb-stack`, `gap-stack` | blocks inside one region: header to action bar, action bar to list, cover to text on phones; dialog body gaps | `mb-6`, `mt-6`, `gap-6` |
| `section` | 40 | `mb-section`, `mt-section`, `py-section` | between page sections; page header to first content; empty-state padding | `mb-8`, `mt-8`, `mb-10`, `mt-10`, `mb-12`, `py-12`, `gap-10` |
| `page` / `page-lg` | 24 / 32 | `p-page md:p-page-lg` | the main column's padding, one call site (`app/(app)/layout.tsx:67`) | `px-6 md:px-8 py-6 md:py-8` |
| `hit` | 40 (or 44) | `size-hit md:size-8` | phone hit box for icon buttons in rows and bars | `h-10 w-10 md:h-8 md:w-8` |

Two rules make the scale compose: a component never sets its own outer
margin (the parent spaces its children with `gap-*` or one `mb-*`), and a
type utility never carries spacing (`text-hero-title` loses its `mt-2`).
Every value in the "replaces" column has a step; the only visible moves are
32 to 40 (section gaps grow) and 12 to 8 (title to meta shrinks), both
listed in stage 1. Values with no role in this app (`gap-5`, `p-5`, `mt-12`)
map to the nearest step during the sweep.

## 3. The collection page as a stack

Phone, 390px wide, with today's number on the right:

```
page 24
[ cover 176, rounded-2xl ]
stack 24                                   (24)
EYEBROW               text-eyebrow
cluster 8                                  (8, from the type utility)
Liked songs           text-hero-title, no margin of its own
cluster 8                                  (12)
10 songs              text-meta
stack 24                                   (0)   <- the fix
( Play 48 ) ( shuffle 48 ) [ Download ]    gap cluster 8   (12)
stack 24                                   (48)
row 64 tall on phones, 56 on desktop        (56)
row ...
section 40 before "Add songs"              (40)
```

Desktop, 1300px: cover 192 on the left, the text block on the right with
`items-end`, then `stack 24`, then the action bar, `stack 24`, the list.
Where the action bar sits is the owner's first decision:

- **Beside**: inside the text column, `stack 24` under the meta, its
  bottom edge on the cover's bottom edge (today's layout minus the 24px
  `ActionBar` margin that lifts it off that edge).
- **Below**: a full-width row under the header, aligned to the content's
  left edge, the album page's layout today.

The same stack serves album, artist and track pages: `CollectionHeader`,
`stack`, `ActionBar`, `stack`, content. The artist description joins the
header text block with `block 16` above it; artist sections use
`section 40` between them and `block 16` under each `SectionHeader`.
`CollectionSkeleton` renders the identical stack from the same tokens, so
the owner's skeletons keep matching the page.

## 4. Track row column system

One grid template for every list that shows tracks, built by a pure
function in `lib/layout.ts` (`trackGridClass`) from list-level flags, never
from what a single row contains. Columns, left to right:

| Column | Width | Present when | Content |
| --- | --- | --- | --- |
| lead | 40 | `lead` is `play` or `rank` | play/pause button, or rank number that swaps to the button on hover (today's behaviour) |
| art | 40 (`art-xs`) | always | artwork, or an empty box with the list's fallback icon (reserved even when artless) |
| main | `minmax(0,1fr)` | always | title (`text-row-title`), artist (`text-row-sub`), unavailable badge and its Replace button |
| album | `minmax(0,1fr)`, md and up | `showAlbum` (column dropped otherwise, not left empty) | album text |
| time | 56 (`3.5rem`), md and up in list, inline in compact | `showDuration` | `tabular-nums`, right aligned, one text size (`text-row-sub`) |
| actions | fixed: slots x 32 + (slots - 1) x 4 on desktop, slots x hit on phones | `slots > 0` | trailing controls, like, remove, right-aligned inside the cell |

Row box: `px-row` (12), column gap `row` (12), `py-cluster` (8) on desktop
for 56px rows; phone padding is the second decision (`py-row` for 64px
rows, or the same 56). Three changes hold the lines:

1. The actions cell has a fixed width from the declared slots
   (`TrackList` sets `--track-actions-w` from `trailing`, `onLike`,
   `onRemove`, via an inline CSS variable the same way `layout.tsx:60`
   sets `--ember-scroller-h`). A row missing a control (no share on an
   upload, no Add on an unavailable track) leaves a gap; the album line
   and the like button never move.
2. Replace moves from the actions cell to the title cell beside the
   Unavailable badge it explains. Same element, same `aria-label`, so
   `TrackRow.test.tsx` and `tests/unavailable-ui.test.mjs` keep passing.
3. The art column is always reserved in list density; artless rows get the
   music icon that search recents already use.

`lead: 'none'` renders the play/pause button absolutely over the art box
(the art is already the row's click target, `TrackRow.tsx:132`), so a list
can drop the lead column without losing the button. Where each list lands:

| List | density | lead | album | time | slots |
| --- | --- | --- | --- | --- | --- |
| Liked, Recent, Uploads, playlist (`CollectionPage`) | list | play | yes | yes | menu 2 + like (+ remove on playlists) |
| Album | list | play | no | yes | menu 2 + like |
| Artist popular | list | rank | yes | yes | menu 2 + like |
| Search page results | list | play | yes | yes | menu 2 + like |
| Search overlay results | list | none or play (decision) | yes | yes | menu 2 + like |
| Search recents (page and overlay) | compact | none | no | no | remove |
| Queue sheet | compact | none | no | yes | none (tone `sidebar`) |
| Track picker | compact | none | no | no | preview + add |
| Admin tracks, session queue | list | none / rank | yes / no | yes / no | adopt in stage 5 |

## 5. Component and utility inventory

| Action | Item | Path | Builds on |
| --- | --- | --- | --- |
| add | spacing tokens (section 2), `hit` | `app/globals.css` `@theme` | the `--spacing-art-*` pattern |
| add | `text-label` (11px caps, sidebar/queue/picker headings), `text-badge` (10px caps pills), `text-row-title`, `text-row-sub`, `text-card-title`, `text-card-sub` | `app/globals.css` `@utility` | existing type utilities |
| change | `text-hero-title` drops `mt-2` | `app/globals.css:124` | |
| add | `TRACK_COLUMNS`, `trackGridClass(opts)`, `trackActionsWidth(slots)` | `lib/layout.ts` (+ `layout.test.ts`) | `SHELF_ROW_COUNT`, `gridColsClass` |
| add | `PageHeader` (h1 + optional actions cluster + optional lede; owns the `section` gap below) | `components/page/PageHeader.tsx` | `PageTitle` (stays as the h1 inside it) |
| add | `Section` (`SectionHeader` + `block` gap + children + `section` gap) | `components/page/Section.tsx` | `SectionHeader` |
| add | Button size `icon-hit` (`size-hit md:size-8`) | `components/ui/button.tsx:22-34` | shadcn `size` variants |
| change | `CollectionHeader`: tokens, `actions` slot placement per decision, description with `block` above, no outer margin | `components/page/CollectionHeader.tsx` | |
| change | `ActionBar`: `gap-cluster`, no outer margin | `components/page/ActionBar.tsx` | |
| change | `CollectionPage`: header, `stack`, `ActionBar`, `stack`, list | `components/library/CollectionPage.tsx` | |
| change | `CollectionSkeleton`: same tokens and stack | `components/page/CollectionSkeleton.tsx` | |
| change | `EmptyState`: `py-section`, `size: 'page' \| 'inline'` replacing the `className="text-sm"` calls; hand-rolled copies in `QueueSheet`, `TrackSearchPicker`, session adopt it | `components/page/EmptyState.tsx` | |
| change | `TrackRow`, `TrackList`: column system, `lead`, `slots`, reserved art, Replace beside the badge, `icon-hit` controls | `components/track/TrackRow.tsx`, `TrackList.tsx` | `lib/layout.ts` |
| change | album, artist, track pages use `ActionBar` and the stack | `app/(app)/album/[id]/page.tsx`, `artist/[id]/page.tsx`, `components/track/TrackPageClient.tsx` | `CollectionHeader` |
| change | home, library, search, settings and admin layouts use `PageHeader`; shelves use `Section` | `app/(app)/page.tsx`, `library/page.tsx`, `search/page.tsx`, `settings/layout.tsx`, `admin/layout.tsx`, `components/track/TrackShelf.tsx`, `library/CollectionShelf.tsx`, `FriendsListening.tsx`, `library/options/*` | |
| change | labels to `text-label`/`text-badge` | `Sidebar.tsx`, `Drawer.tsx`, `QueueSheet.tsx`, `TrackSearchPicker.tsx`, `CreatePlaylistDialog.tsx`, `MobileNav.tsx`, `SeekBar.tsx`, settings plugins, session, `BugReportDialog.tsx`, `TabsDialog.tsx` | |
| change | `PlayerBar`, `TopBar`, `NowPlaying`, `MobileNav`: tokens, `icon-hit`, matching spacer | `components/player/PlayerBar.tsx`, `nav/TopBar.tsx`, `player/NowPlaying.tsx`, `nav/MobileNav.tsx` | |
| move | `CollectionCover` to `components/primitives/` so `page/` stops importing from `library/` (`CollectionHeader.tsx:2`) | `components/primitives/CollectionCover.tsx` | `Artwork` |
| change | `lintRules.test.ts`: new bans and the ratchet (section 6) | `lib/lintRules.test.ts` | |
| change | `eslint.config.mjs`: layering rules (section 6) | `eslint.config.mjs` | |
| change | `CollectionHeader.test.tsx:33` stops querying `.mt-3` (a `data-testid` on the meta line instead) | `components/page/CollectionHeader.test.tsx` | |
| delete | `ActionBar`'s `mb-6`; `pt-4 md:pt-0` at three sites; the private admin `TrackRow` and the session hand rows (stage 5); the hand-rolled empty states | see above | |

Justified new components: `PageHeader` (seven pages spell the header six
ways) and `Section` (eight raw `section mb-10` + `h2` sites). Everything
else extends what exists. No `Stack` or `Box` wrapper: tokens on the
parent are enough and stay greppable.

## 6. Enforcement

Style lint, `lib/lintRules.test.ts`, scanning `app/` and `components/`
minus `components/ui/` (shadcn, its 6px icon gaps are its own):

- Raw spacing: `(m[tbxy]?|p[tbxy]?|gap(-[xy])?|space-[xy])-(\d+(\.\d+)?|px)` as a
  class token; allowed: `-0`, `-auto`, negative margins used for scroll
  bleed (`-mx-1`). Introduced in stage 1 as a ratchet: a `SPACING_BASELINE`
  map of file to allowed hit count; a file over its baseline fails, a file
  under it also fails until the baseline is lowered, a file not in the map
  must have zero. Each stage lowers the map; stage 5 empties it.
- Type: ban `text-[` anywhere, `uppercase tracking-wide` outside
  `globals.css` (use `text-eyebrow`, `text-label`, `text-badge`), and the
  substrings `text-xl font-bold tracking-tight`, `text-3xl md:text-4xl`,
  `text-4xl md:text-5xl` (today's exact-match bans become substring bans).
- Layout: ban `grid-cols-[` outside `lib/layout.ts` (the three admin grids
  and `PlayerBar.tsx:86` get entries there), square `h-N w-N` pairs (use
  `size-*` or a Button size), and `py-\d+ text-center` (use `EmptyState`).

ESLint, `eslint.config.mjs`, `no-restricted-imports` patterns:

- Layering: `components/primitives/**` imports only `@/components/ui/*`,
  `@/components/icons` and `@/lib/*`; `components/page/**` adds
  `@/components/primitives/*`; `components/{track,library,nav,search}/**`
  may not import `@/components/player/*` or `@/app/*`.
- Presentational set gains `components/search/SearchOverlay.tsx` and
  `app/(app)/dizajn/**` (the gallery stays mock-only: no hooks, stores,
  react-query or `PlayerProvider`).
- Nothing outside `app/(app)/dizajn/**` may import
  `@/components/library/options/*`, so an unchosen option cannot leak into
  the live app.

The 9 pre-existing lint errors stay pre-existing; a stage must not add any.

## 7. Stages

Each stage is one branch commit pair, independently shippable, tests green
(`npm run test:unit`, `npm run lint`, `tsc --noEmit`, plus the browser
suites named). Screenshots are taken at 390 and 1300 from the sandbox app
(tests/README.md) into the scratchpad for the stage report; `/dizajn`
carries the live renders, not images.

### Stage 1: Rhythm

The spacing tokens and the collection page stack. First visible win: Liked.

- Files: `globals.css` (tokens, `text-hero-title`), `CollectionHeader`,
  `ActionBar`, `CollectionPage`, `CollectionSkeleton`, `app/(app)/layout.tsx`
  (`p-page`), album, artist, track pages, `TrackPageClient`,
  `CollectionCover` move, `lintRules.test.ts` (ratchet with baseline),
  `dizajn/page.tsx` + `mock.ts` (mock tracks).
- Tests: a unit test reads `globals.css` and asserts every token in
  section 2 exists with its value; `CollectionHeader.test.tsx` asserts the
  gap classes and the `data-testid` meta line; `CollectionPage` test
  asserts header, action bar and list order; skeleton test asserts it uses
  the same classes as the header. Browser: `tests/library-collections-ui.test.mjs`.
- `/dizajn`: "Spacing scale" (rulers with name and px), "Collection page"
  rendering `CollectionPage` from mock tracks with two pickers.
- Risk: low to medium; visual only, both `CollectionHeader` tests and the
  skeleton pin the geometry.
- Approve: **Rhythm**: `Even` (meta to actions 24, actions to list 24) or
  `Grouped` (16 then 32: actions belong to the header). **Actions**:
  `Beside` or `Below` (section 3).

### Stage 2: Columns

The track row column system across all eight `TrackRow` call sites.

- Files: `lib/layout.ts` (+ test), `TrackRow`, `TrackList`,
  `SearchOverlayContainer`, `search/page.tsx`, `QueueSheet`,
  `TrackSearchPicker`, `menus/TrackMenu.tsx` (no change, documented slot
  count), `search/loading.tsx` and `CollectionSkeleton` rows on the same
  template, `lintRules.test.ts` (baseline lowered).
- Tests: `layout.test.ts` covers every flag combination and the actions
  width; `TrackRow.test.tsx` gains cases for reserved art, `lead: 'none'`
  (the Play button still exists and still calls `onPlay`), Replace beside
  the badge; `TrackList.test.tsx` asserts `--track-actions-w` follows the
  declared slots. Browser: `tests/unavailable-ui.test.mjs`,
  `tests/instant-search-ui.test.mjs`, `tests/uploads-ui.test.mjs`.
- `/dizajn`: "Track rows" showing one mixed list (an upload without share,
  an unavailable track, an artless track, a long title) in list density,
  the overlay recents above overlay results, the queue rows and the picker
  rows, with pickers.
- Risk: medium; `TrackRow` carries double-click, artist-link
  `stopPropagation` and remove behaviour, all pinned by existing tests.
- Approve: **Rows**: `Comfortable` (64px on phones, 56 on desktop) or
  `Uniform` (56 everywhere). **Overlay results**: `Aligned` (no lead cell,
  play on the art, art lines up with recents) or `Classic` (lead cell).

### Stage 3: Page shapes

Home, Library, Search, Settings and Admin on `PageHeader`, `Section` and
one `EmptyState`.

- Files: `PageHeader.tsx`, `Section.tsx`, `EmptyState.tsx` and their tests;
  `app/(app)/page.tsx`, `library/page.tsx`, `library/loading.tsx`,
  `search/page.tsx`, `search/loading.tsx`, `settings/layout.tsx`, settings
  child pages, `admin/layout.tsx`, `session/[id]/page.tsx` header;
  `TrackShelf`, `CollectionShelf`, `FriendsListening`, `library/options/*`;
  `QueueSheet`, `TrackSearchPicker`, session empty states; the ratchet.
- Tests: `PageHeader` (h1, actions slot, lede), `Section` (heading, action,
  children), `EmptyState` sizes; existing `search/page.test.tsx` and
  `search-parity.test.tsx` stay green; `dizajn/page.test.tsx` gains the new
  sections. Browser: `tests/library-collections-ui.test.mjs`,
  `tests/instant-search-ui.test.mjs`.
- `/dizajn`: "Page shapes" rendering the home, library and settings header
  blocks from mock data side by side, and the empty-state candidates.
- Risk: low; margins and wrappers only.
- Approve: **Empty states**: `Quiet` (muted text, `section` padding, what
  exists) or `Framed` (a card with an icon and the message).

### Stage 4: Touch

Phone density and hit sizes; the player bar, top bar and nav.

- Files: `button.tsx` (`icon-hit`), `TrackRow` controls, `LikeButton`,
  `ShareButton`, `AddToPlaylistMenu` trigger, `PlayerBar`, `NowPlaying`,
  `TopBar`, `MobileNav`, `TransportControls` sizes to tokens; the ratchet.
- Tests: `LikeButton`, `TransportControls`, `NowPlayingSummary` tests
  assert the size classes; `TrackRow.test.tsx` asserts the phone hit class
  on its controls. Browser: `tests/android-player-ui.test.mjs`,
  `tests/tabs-ui.test.mjs`; hand check on an Android phone for the bar and
  the full-screen view.
- `/dizajn`: "Touch" rendering a list row, the player bar cluster and the
  top bar at phone width with both hit sizes.
- Risk: medium on phones; the shell and the full-screen view have bitten
  before (`app/(app)/layout.tsx:44-47`, `NowPlaying.tsx:135-140`).
- Approve: **Hit size**: `Standard` (40) or `Large` (44).

### Stage 5: Lock

Sweep the rest onto the tokens and turn the guard rails on.

- Files: dialogs under `components/track/menus/`, `BugReportDialog`,
  `RequestDialog`, `TabsDialog`, `LyricsBody` labels, `PrivacyToggles`,
  settings and admin pages, `admin/tracks` and `session` rows onto
  `TrackRow`; `lintRules.test.ts` (baseline emptied, bans unconditional);
  `eslint.config.mjs` layering rules; `README.md` layout tree,
  `tests/README.md`, `docs/deslop/CHANGES.md` gets a section per stage.
- Tests: the lint test at zero is the test; `admin/tracks` and session
  rows get a render test each; `npm run lint` shows the same 9 errors.
- `/dizajn`: a "Type" section (every utility as a specimen) next to the
  spacing rulers, so the sheet is complete.
- Risk: low.
- Approve: nothing to pick; the owner confirms the `/dizajn` sheet reads as
  one system.

Implementation tier: stage 2 is cross-cutting (eight call sites, three
browser suites) and suits the opus worker; stages 1, 3, 4 and 5 suit the
sonnet worker, one stage per run, each ending with the two commits above.

## 8. Out of scope

- The light theme (`globals.css:70` keeps it a possibility, nothing here
  touches colour).
- New features: sticky action bar on scroll, drag to reorder, filter
  chips, "Show all" on library shelves, anything in
  `docs/deslop/design-options.md` beyond the layout the pages already have.
- The library shelf choice (Editorial, Dense list, Featured mix,
  Cover-led): already on `/dizajn`, a separate decision; stage 3 only puts
  the four options on `Section`.
- Android and desktop shells beyond what the web layout implies: Capacitor,
  Tauri, Android Auto, native offline, the `EmberOffline` plugin.
- Dialog internals (forms, flows), `LyricsPanel`/`LyricsBody`/`TabViewer`
  layout, `PlayerProvider`, the search overlay's provisional chrome
  (`SearchOverlay.tsx:44`) beyond its rows and spacing.
- The 9 pre-existing eslint errors and the React 18/19 hoisting follow-up
  in `docs/DESLOP.md`.
