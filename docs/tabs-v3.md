# Tabs v3: fetch real tabs, line them up with the recording

Plan only. Branch `tabs-rebuild`, unreleased 0.3.3 "A real tab page". Paths are relative to `apps/web/` unless they start with `docs/`, `tests/` or the repo root. Read `docs/tabs-rebuild.md` and `docs/tab-sources.md` first: the page, the store, `lib/tabText.ts` and the sync in `lib/tabSync.ts` stay as they are.

Owner's decision: Ember fetches tabs from the web for this private server. The line: no DRM, no logins, no signed or obfuscated APIs. Plain pages and JSON a browser gets are fine. One fetch per song, cached forever, polite.

## 1. Sources, checked live on 2026-09-19

| Source | What a browser gets | Verdict |
|---|---|---|
| Songsterr search | `GET /api/songs?pattern=artist title` (already used by `lib/songsterr.ts:48`): songId, tracks with instrument, tuning, difficulty | Keep |
| Songsterr notes | Song page `/a/wsa/<slug>-tab-s<songId>` has `<script id="state">` JSON: `meta.current.revisionId`, `meta.current.image`, `tracks[].partId`. Notes: `https://dqsljvtekg760.cloudfront.net/<songId>/<revisionId>/<image>/<partId>.json`. Plain gzip JSON, no cookie, no auth, no signature, no expiry (`cache-control: max-age=31536000`). Shape: `measures[].voices[].beats[]` with `duration [1,8]`, `notes[]{string,fret,tie,dead,ghost}`, `signature`, `tempo`, `automations.tempo`, `tuning`, `anacrusis` | Openly served: fetch it. Real rhythm, every instrument. Best source |
| Ultimate Guitar search | `https://www.ultimate-guitar.com/search.php?search_type=title&value=artist title&type=200` (200 Tab, 400 Bass Tab, 300 Chords, 500 Pro, 900 Official). The HTML carries `<div class="js-store" data-content="...">`: `store.page.data.results[]` with `id, type, rating, votes, tab_url, tab_access_type, version`. Needs a browser User-Agent, no cookie | Fetch it |
| Ultimate Guitar tab text | The tab page's `js-store`: `tab_view.wiki_tab.content` (text with `[tab]..[/tab]` marks, `\r\n`), `tab_view.meta.tuning`, `tab_view.versions` (sibling versions), `tab.rating`, `tab.votes` | Fetch it, strip marks, through `lib/tabText.ts` |
| UG Pro and Official | App and login only | Skip, link-out stays |
| Other text-tab sites | Copies of UG with less data | Skip |

Pick per song: Songsterr guitar or bass part with a matching instrument first; then the UG Tab (or Bass Tab for the bass picker) with the most votes and rating 4+; then the other online matches for the picker. Chords-only results are never drawn.

Politeness, server side only (`lib/tabFetch/*.ts`, admin PB client): browser User-Agent, one global queue with 2 s between requests, at most 3 requests per song (search, page, part), 429 or 503 backs off for an hour, a miss is remembered for a day, nothing re-fetches on its own. `SONGSTERR_BASE` and a new `UG_BASE` point tests at fakes.

## 2. Store

New `TabKind` value `fetched` (`lib/tabSources.ts:10`), ranked before `file`: a row per fetched tab, `format: alphatex`, `shared: true`, `user` empty, `song_key` as today. New fields on `tabs` (`pocketbase/pb_hooks/ensure_tabs.pb.js`): `source_site` (songsterr, ug), `source_url`, `source_id`, `source_rating`, `source_votes`, `timing` (JSON, section 3). On disk in `MUSIC_DIR/tabs/fetched/`: `<stem>.alphatex` plus the raw `<stem>.json` or `.txt` so a converter fix re-parses without a refetch. Songsterr to alphaTex is a new pure module `lib/songsterrPart.ts` (durations, ties, dead and ghost notes, time signatures, tempo automations, anacrusis, tuning, section markers).

## 3. Lining a tab up with the recording

The tab gives the notes; the audio gives the time. New `align.py` beside `transcribe.py`, reusing `track_beats` (`transcribe.py:213-217`) and `beat_grid` (`:49`).

1. Beats and downbeats: `librosa.beat.beat_track` for the beat times, `librosa.onset.onset_strength` for the onset curve, downbeat phase = the beat offset (0..N-1, N from the tab's time signature) with the strongest onsets.
2. The tab's expected onsets per bar (beat positions from durations; text tabs use their 16th grid).
3. Offset: lay the tab's onsets over the tracked beats starting at each candidate downbeat in the first 40 s, correlate with the onset curve, refine to 10 ms. Second score: the tab's pitches as chroma against `chroma_cqt` at the same alignment. The best sum is the offset and the confidence.
4. Output `timing`: `{ offset_ms, bpm, confidence, bars: [{ bar, ms }] }`, one anchor per bar at the tracked downbeats, so a drifting recording stays lined up.

`lib/tabSync.ts` gains `songSecToTabMs(sec, timing)` and its inverse: piecewise linear between bar anchors, then the plain `offset_ms` path when there are no anchors. The nudge still applies on top. Confidence under the threshold shows "not lined up yet" on the chip; the tab still draws at offset 0. Several candidates: each is aligned, the best score wins, the rest stay in the picker. The generated tab (`transcribe.py`) stays last, button only, labelled rough.

## 4. ffmpeg

The Mac works because `.venv/bin/ffmpeg` is a hand-made symlink (2026-05-16) into `imageio_ffmpeg`. Nothing makes it on the host.

| Where | Today | Fix |
|---|---|---|
| `transcribe.py:184-186` | `shutil.which("ffmpeg")`, fails "ffmpeg is not installed" | `ffmpeg_exe()`: `imageio_ffmpeg.get_ffmpeg_exe()` first, then `which`; message "ffmpeg is missing: run ./update.sh" |
| `player.py:164` and `download_by_id` | yt-dlp finds ffmpeg by PATH | pass `ffmpeg_location` from the same resolver |
| `lib/sources/youtube.ts:59-63` | relies on the symlink | unchanged, the symlink now exists |
| `update.sh:236-247` | pip upgrades only yt-dlp and ytmusicapi | add `imageio-ffmpeg`, then create `.venv/bin/ffmpeg -> get_ffmpeg_exe()`; `requirements.txt` lists it |

librosa 1.0 decodes wav through soundfile, so the decode step keeps the bundled ffmpeg for m4a, webm and opus. The alignment step reads the same wav.

## 5. Overflow

| Place | Rule |
|---|---|
| Source picker `TabsPage.tsx:337-343` and the ⋯ menu `:189-218` | `DropdownMenuContent` gets `max-w-[calc(100vw-2rem)]`; every item `truncate` with a `title` |
| Picker rows (new) | site, type, rating in fixed columns; the name column `min-w-0 truncate`. A Songsterr track name ("Kurt Cobain \| Fender Strat/Mustang \| Solo") is one line |
| Header chip row `TabSheetHeader.tsx:51`, sync row `TabsPage.tsx:365` | already `flex-wrap`; the chip itself gets `max-w-full truncate` |
| Toolbar chips `TabsToolbar.tsx:62` | already `overflow-x-auto` |

Browser check: `tests/tabs-ui.test.mjs`, new section "nothing overflows", at 390, 1280 and 1920: open the picker and the ⋯ menu with 8 fake matches with 60-character names, assert every item's `getBoundingClientRect().right <= innerWidth` and `document.documentElement.scrollWidth === innerWidth`.

## 6. The flow, same look

Open `/tabs/[trackId]`: rows exist, draw the best. No rows: the page shows "Finding a tab online" while the server searches Songsterr then UG, fetches the best, aligns it, records the rows, and the page draws it synced. Chip: "From Songsterr, Rhythm Guitar, lined up" with the picker underneath: online matches (site, type, rating, instrument), then files, pasted, generated. ⋯ menu adds "Line it up again" (re-runs `align.py` for the current tab) and "Search online again". Paste and file upload stay. Two `/dizajn` candidates under "Guitar tabs" (`app/(app)/dizajn/page.tsx:227`):

- A. Picker menu: the chip's dropdown, grouped by site, one line per tab with a small rating. Recommended.
- B. Source sheet: a bottom sheet (phone) or side panel with a card per match, rating, instruments, a four-bar preview.

## 7. Tests

| Level | Where | Covers |
|---|---|---|
| Unit | `lib/tabFetch/ug.test.ts`, `lib/songsterrPart.test.ts` | Fixtures in `lib/__fixtures__/fetch/`: saved UG search and tab HTML, a Songsterr page state and part JSON, all with our own original tab content substituted, never a real song. Ranking, marks stripping, alphaTex round trip through `AlphaTexImporter` |
| Unit | `lib/tabSync.test.ts` | `songSecToTabMs` with anchors, drift, no anchors, the nudge on top |
| Sandbox | `tests/fake-ug.mjs`, extend `tests/fake-songsterr.mjs` (page, part, 429, `/__calls`), `tests/tabs-fetch.test.mjs` | One fetch per song, cache, backoff, kind fetched rows, files on disk, re-parse |
| Alignment | `tests/tabs-align.test.mjs` on synthetic wavs (`tests/transcribe-timing.test.mjs` style): click plus a riff at 97.4 bpm with 0.35 s offset, a tempo drifting 100 to 108, the wrong tab | Offset within 30 ms, anchors within 40 ms, the wrong tab scores lower |
| ffmpeg | `tests/ffmpeg-resolve.test.mjs` | `transcribe.py --print-ffmpeg` with an empty PATH; `update.sh` symlink step against a temp venv |
| Browser | `tests/tabs-ui.test.mjs` | Auto-fetch draws and syncs against the fakes, the picker, "Line it up again", overflow at three widths |

No test touches the internet.

## 8. Stages

| Stage | Ships | Bullet for 0.3.3 | Tier |
|---|---|---|---|
| 1. ffmpeg | Resolver, `update.sh`, `requirements.txt`, test | Generating a tab no longer needs ffmpeg installed on the server | sonnet |
| 2. Overflow | Section 5, browser check | none | sonnet |
| 3. UG fetch | `lib/tabFetch/ug.ts`, kind fetched, store fields, fake, fixtures, sandbox test | Ember finds a text tab on Ultimate Guitar for the song and draws it | opus |
| 4. Songsterr notes | Page state, part JSON, `lib/songsterrPart.ts`, fake, tests | Songsterr's tab, with real rhythm, drawn inside Ember | opus |
| 5. Alignment | `align.py`, `timing`, `tabSync` anchors, "Line it up again", synthetic tests | The tab is lined up with the recording by listening to it | opus |
| 6. Picker | `/dizajn` A and B, owner picks, the chosen picker, browser test | Pick between every tab found online and the ones on your server | sonnet |
| 7. Best match | Align every candidate, the best score wins | The tab that matches the recording best is chosen for you | opus |

## Decisions for the owner

1. Fetch Songsterr's part JSON (open, unsigned, no login)? Recommended: yes, it is the only source with rhythm.
2. Search online on opening the page, or only after a click? Recommended: on opening, once per song, cached.
3. A low alignment score: draw the tab anyway with "not lined up yet", or hide it? Recommended: draw it.

## Stages 1 to 3 as built

Owner's decisions for this round: Ember fetches plain public pages only (no DRM, login, signed or encrypted APIs); the tab page searches online once per song, cached in the shared store, with a manual "Search online again"; a tab not lined up yet is drawn anyway with a calm note; the Source sheet (candidate B) is round 3, this round only labels fetched tabs in the existing picker. Source order: file > pasted > fetched > generated (Songsterr slots in above UG next round), which overrides "ranked before file" in section 2.

- **ffmpeg.** `ffmpeg_path.py` (repo root) resolves `imageio_ffmpeg.get_ffmpeg_exe()` then `which ffmpeg`; `transcribe.py` fails with "ffmpeg is missing: run ./update.sh"; every yt-dlp option set in `player.py` gets `ffmpeg_location`. `update.sh` installs `imageio-ffmpeg` if missing and relinks `.venv/bin/ffmpeg` on every run (`UPDATE_FFMPEG_ONLY=1` runs just that step, for `tests/ffmpeg-resolve.test.mjs`). `lib/sources/youtube.ts` and the tab generator keep prepending `.venv/bin` to PATH, which now always holds the link.
- **Overflow.** Tab page menus are `w-max min-w-56 max-w-[calc(100vw-2rem)]`, every item one truncated line with a `title`; the source chip is `max-w-full` with a truncated label; the title and meta line break long words. `tests/tabs-ui.test.mjs` "nothing overflows" at 390, 1280, 1920.
- **UG fetch.** `lib/tabFetch/ug.ts` (pure: js-store, search results, ranking, tab page, marks, tuning), `lib/tabFetch/polite.ts` (one queue per site for the server, 2 s gap, browser User-Agent, an hour's backoff on 429, 403 or 503, and on a 200 page without data), `lib/tabFetch/online.ts` (once per song, rows and files), `POST /api/tabs/online`. One search with `type[]=200&type[]=400` (checked live: one request returns both), then at most 2 tab pages: the best guitar Tab and the best Bass Tab, 3 requests per song as section 1 allows; a page without notes or gone (404) spends its turn and the next candidate is tried while turns remain. Ranking: whole-song tabs rated 4+ with at least 5 votes, then partial ones ("intro", "solo": the live search showed the most-voted tab can be an intro only), then the rest; inside each, most votes. A result must have the song's exact title words and, when the artist is known, share an artist word. Skipped: Chords, Pro (Guitar Pro), Official, a non-`public` `tab_access_type`, the app's marketing rows, any link that is not `https://tabs.ultimate-guitar.com/tab/...`.
- **Store.** `tabs` gains `source_site`, `source_url`, `source_id`, `source_rating`, `source_votes`, `source_meta` (part, version, section, UG's names, tuning, capo, the parse report); `kind` gains `fetched`. New admin-only collection `tab_lookups` (song_key + site unique, status found or none, query, searched_at, the top 8 candidates for the picker). A clean "nothing found" is remembered like a find (never searched again on its own, per the owner); a failure (network, backoff, block page) records nothing, so a later opening tries again after the pause. Files: `MUSIC_DIR/tabs/fetched/<stem>.alphatex` beside `<stem>.txt` (the tab text, marks removed). Fetched rows have no uploader, so only an admin deletes one or saves its nudge for everyone.
- **Page.** The tab page asks `POST /api/tabs/online` once the store answered (React Query, never refetched in the session; the server answers "cached" after the first time). With nothing else to draw it shows "Finding a tab online…". Chip: "From Ultimate Guitar[, ver N][, bass], not lined up yet"; picker line: "Ultimate Guitar, Text tab[, ver N], ★ 4.7 (512 votes)". The ⋯ menu has "Search online again" and, when it found nothing new, one quiet line. Tempo is the tab's own (a Tempo line, else 120), the start is the song's start plus the nudge.
- **Tests.** Fixtures `tests/fixtures/ug` built by `build.mjs` (UG's shape from one live capture, every name and note invented), `tests/fake-ug.mjs` (`UG_BASE`), unit tests in `lib/tabFetch/*.test.ts` and `app/api/tabs/tabs-online-route.test.ts`, browser `tests/tabs-fetch.test.mjs`.
