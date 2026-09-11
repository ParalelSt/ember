# Ember layout: three directions

Companion to `docs/DESLOP.md` (section c). Three whole-app layout directions,
each covering Library, Home, Search, collection pages (playlist, Liked,
Recently played, Uploads, album), and the player on phone and desktop.

Shared facts: a "collection" is anything that opens as a page with cover,
title, count, Play, Shuffle and Download for offline (Liked, Recently played,
Uploads, every user playlist, albums); the `library-playlists` branch supplies
the system-collection pages. A fresh account has 3 system collections and 0
playlists; a typical one has 3 plus 3 to 10 playlists, and the layout must
look intentional at both. The phone/desktop line stays at `md` (768px). In
every option the phone keeps the bottom tab bar, the mini player bar and the
full-screen Now Playing overlay, and desktop keeps the bottom player bar;
they are left out of the wireframes below. Legend: `[art]` square cover,
`*` filled play button, `~~~` scroll continues.

## Option 1: Library rail (Spotify desktop, 2023 style)

Concept: the desktop sidebar becomes "Your Library". Nav links sit on top,
below them a scrollable list of every collection as a row (small cover, name,
one-line subtitle), with filter chips (Playlists, Liked, Recent, Uploads) and
a "+" to create, import or upload. The `/library` route on desktop is the
same list rendered large as a grid; on phone `/library` is the rail's list
full-width. Home and Search are unchanged shelves. Collection pages use a
tall gradient header drawn from the cover's dominant tone.

### Library, desktop (rail + grid)

```
+--------------+-----------------------------------------------+
| Ember        |  Your library                 [grid] [list]   |
| Home         |  (Playlists) (Liked) (Recent) (Uploads)       |
| Search       |                                               |
| Library      |  [art]     [art]     [art]     [art]          |
|--------------|  Liked     Recent    Uploads   Road trip      |
| Your library |  42 songs  50 songs  7 songs   18 songs       |
| (Playlists)  |                                               |
| [a] Liked    |  [art]     [ + ]                              |
| [a] Recent   |  Gym       New playlist                       |
| [a] Uploads  |  9 songs                                      |
| [a] Road trip|                                               |
| [a] Gym      |                                               |
+--------------+-----------------------------------------------+
```

### Library, phone

```
+---------------------------+
| Your library         [+]  |
| (Playlists)(Liked)(Recent)|
| [art] Liked songs      >  |
|       42 songs            |
| [art] Recently played  >  |
|       50 songs            |
| [art] Uploads          >  |
|       7 songs, shared     |
| [art] Road trip        >  |
|       Playlist, 18 songs  |
| [ + ] New playlist        |
+---------------------------+
```

### Collection page, desktop

```
+--------------+-----------------------------------------------+
| (rail)       | ######## gradient from cover ################ |
|              | [art 192]  PLAYLIST                          |
|              |            Road trip                         |
|              |            18 songs, 1 h 12 min              |
|              |-----------------------------------------------|
|              |  *  (shuffle) (download) (...)               |
|              |  #  Title / Artist        Album      3:10    |
|              |  1  ...                                       |
|              |  ~~~                                          |
+--------------+-----------------------------------------------+
```

### Collection page, phone

```
+---------------------------+
| <                         |
|        [art 176]          |
|        Road trip          |
|        18 songs           |
|  (dl) (shuffle)      *    |
|  [a] Title            ... |
|      Artist               |
|  ~~~                      |
+---------------------------+
```

Borrows from Spotify: the rail, filter chips, rows with tiny covers, gradient
header. Avoids: the three-panel desktop with a right "now playing" column,
the friend activity feed, and hover-only affordances on rows.

With only a few collections: the rail is a list, so 3 to 6 rows look normal.
The desktop `/library` grid is the weak spot: 3 cards plus a "New playlist"
tile in a 6-column grid reads as empty, so the grid must cap at `auto-fill`
with a 176px minimum and left-align, never stretch.

Trade-offs:
- Most Spotify-like on desktop; most structural change (sidebar rewrite,
  width jumps from 240 to about 320, fights the LyricsPanel for width).
- Duplicates the library twice on desktop (rail and page).
- Needs collection subtitles and counts in the sidebar query, so playlists
  list must carry counts (API change or a second query).

## Option 2: Shelves (extend Home's grammar to Library)

Concept: every top-level page is a stack of shelves: a section title, an
optional "Show all", and a horizontal row of cards (phone) or a wrapped grid
of one row (desktop), exactly like Home today. Library becomes: a "Your
collections" shelf holding Liked, Recently played, Uploads as large cards,
then a "Playlists" shelf, then "Recently played" tracks. The sidebar keeps
nav plus a short list: the three system collections, then playlists. Search
adds a "Browse" shelf when the query is empty. Collection pages get a compact
header (cover left, text right, actions inline) that collapses into a sticky
action bar on scroll.

### Library, desktop

```
+--------------+-----------------------------------------------+
| Ember        |  Your library          Session Import Upload  |
| Home         |                                               |
| Search       |  Your collections                             |
| Library      |  [art 160]     [art 160]     [art 160]        |
| Settings     |  Liked songs   Recently      Uploads          |
|--------------|  42 songs      played 50     7 songs          |
| Liked songs  |                                               |
| Recently pl. |  Playlists                     Show all (5)   |
| Uploads      |  [art] [art] [art] [art] [art] [ + ]          |
| Road trip    |  Road  Gym   Chill Focus Party New            |
| Gym          |                                               |
| ...          |  Recently played                              |
|              |  [art] [art] [art] [art] [art] [art]          |
+--------------+-----------------------------------------------+
```

### Library, phone

```
+---------------------------+
| Your library        [...] |
|                           |
| Your collections          |
| [art 140]  [art 140]  [ar |
| Liked      Recent     Upl |
|                           |
| Playlists      Show all   |
| [art] [art] [art] [ + ]   |
| Road  Gym   Chill New     |
|                           |
| Recently played           |
| [art] [art] [art] ~~~     |
+---------------------------+
```

### Collection page, desktop

```
+--------------+-----------------------------------------------+
| (sidebar)    | [art 160]  LIKED SONGS                        |
|              |            Liked songs                        |
|              |            42 songs, 2 h 40 min               |
|              |            *  (shuffle) (download) (...)      |
|              |-----------------------------------------------|
|              |  #  Title / Artist        Album      3:10     |
|              |  ~~~  (on scroll: sticky bar "Liked songs *") |
+--------------+-----------------------------------------------+
```

### Collection page, phone

```
+---------------------------+
| <                   (...) |
| [art 120] Liked songs     |
|           42 songs        |
|  *  (shuffle) (download)  |
|  [a] Title            ... |
|      Artist               |
|  ~~~                      |
+---------------------------+
```

Borrows from Spotify: shelves with "Show all", the compact sticky header on
scroll, cards with square art. Avoids: the rail, the gradient hero, filter
chips.

With only a few collections: shelves never leave a half-empty grid because a
shelf is one row by definition; three large cards in "Your collections" is
the intended state, not a sparse one. An empty "Playlists" shelf shows a
single "New playlist" card. This is the option that looks best at 3 items.

Trade-offs:
- Reuses TrackShelf and cards that already exist; smallest new surface.
- Library becomes a browse page rather than an index; finding one playlist
  among 30 means "Show all" and a grid, which is one tap more than a list.
- Horizontal scrolling on phone for the Playlists shelf is fine at 10 items,
  poor at 40 (mitigated by "Show all").

## Option 3: Index list (Spotify mobile everywhere)

Concept: Library is one vertical list of every collection, sorted by last
played, with the three system collections pinned on top and shown with an
icon cover instead of art. Filter chips narrow the list; a list/grid toggle
on desktop switches to cards. The same component renders in the sidebar as a
short "recent collections" list. Home stays shelves. Collection pages use
the compact header from Option 2. Search unchanged.

### Library, desktop

```
+--------------+-----------------------------------------------+
| Ember        |  Your library      [search] [list|grid] [+]   |
| Home         |  (All) (Playlists) (Liked) (Recent) (Uploads) |
| Search       |                                               |
| Library      |  [heart] Liked songs          42 songs        |
| Settings     |  [clock] Recently played      50 songs        |
|--------------|  [up]    Uploads              7 songs, shared |
| Recent       |  [art]   Road trip            Playlist, 18    |
| Liked songs  |  [art]   Gym                  Playlist, 9     |
| Road trip    |  [art]   Chill                Playlist, 31    |
| Gym          |                                               |
|              |                                               |
+--------------+-----------------------------------------------+
```

### Library, phone

```
+---------------------------+
| Your library    [srch][+] |
| (All)(Playlists)(Liked).. |
| [heart] Liked songs       |
|         42 songs          |
| [clock] Recently played   |
|         50 songs          |
| [up]    Uploads           |
|         7 songs, shared   |
| [art]   Road trip         |
|         Playlist, 18 songs|
| [art]   Gym               |
|         Playlist, 9 songs |
+---------------------------+
```

### Collection page

Same as Option 2 on both widths. The icon cover carries through: a heart,
a clock or an upload arrow on the ember gradient.

Borrows from Spotify: the mobile library list, chips, sort by recent, pinned
items, icon covers for system collections. Avoids: the desktop rail, the
gradient hero, shelves on Library.

With only a few collections: a 3 to 6 row list is a normal list; nothing
is stretched. On desktop the list is capped at 720px wide and left-aligned
so it does not become a table of empty space.

Trade-offs:
- Cheapest to build and to test (one row component in two sizes).
- Least visual; the Library stops showing art at a glance unless the user
  flips to grid.
- Desktop feels phone-shaped unless the grid toggle defaults to grid above
  a threshold (for example 8 or more items).

## Recommendation: Option 2 (Shelves), with two borrows

Take Option 2. It is the only direction whose "few items" state is its
designed state: three large collection cards in one shelf reads as complete
on both phone and desktop, while Options 1 and 3 need caps and alignment
tricks to hide emptiness in a grid or feel phone-shaped on desktop. It reuses
the grammar Home already has (shelf, card, "Show all"), so the reusable
components in `DESLOP.md` (TrackShelf, CollectionCard, SectionHeader,
CollectionHeader) serve Home and Library with no Library-only layout code.
It leaves the desktop shell alone (sidebar width, LyricsPanel column, player
bar), which is where the risk lives. Borrow two things: from Option 1, list
the three system collections at the top of the sidebar's playlist list so
desktop gets a rail-lite without a rewrite; from Option 3, icon covers for the
system collections so they are distinguishable from user playlists at a
glance. Revisit Option 3's list mode only if playlists regularly exceed
about 20, at which point a "Show all" grid can gain a list toggle.
