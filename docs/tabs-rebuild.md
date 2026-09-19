# Tabs rebuild: a real tab system

Plan only. Goal: the tabs feature looks and behaves like Songsterr. Same idea as today (find the song, show a tab synced to playback, sources in priority order), refined.

## 1. What exists

| Piece | Where | State |
|---|---|---|
| Dialog with three sources | `components/player/TabsDialog.tsx:23-31` | Songsterr list links out; own files and generated tabs open the viewer |
| Viewer | `components/player/TabViewer.tsx:175-197` | AlphaTab 1.8.4 (`apps/web/package.json:15`), external media mode, cursor follows Ember |
| Viewer limits | `TabViewer.tsx:387` (60vh, white box), `:391-426` (own transport), `:239-254` (seek by echo guessing), `:187` (scale 0.8, no rhythm, no theme) | This is the visual gap |
| Songsterr search proxy | `app/api/tabs/route.ts:8-16`, cache `:39-41` | Metadata only; notation is licensed, never fetched |
| Own files | `lib/tabs.ts:24`, PB `tabs` collection, private per uploader (`pb_hooks/ensure_tabs.pb.js:26-27`) | Works |
| Generated tabs | `transcribe.py`, `lib/tabGenerate.ts:15-16` (file on disk is the state) | Guitar only, 4/4, standard tuning (`transcribe.py:25-31`), greedy fingering (`:39-47`) |
| Player backends | `lib/playback/types.ts:36-44` | No playback rate, needed for speed control |

## 2. Research: who gives real notes

Checked live on 2026-09-18.

| Service | Notes? | Format | Cost | Legal inside Ember | Lookup |
|---|---|---|---|---|---|
| Songsterr | No. Public `/api/songs` gives songId, tracks, instrument, tuning, difficulty | JSON metadata | Free, non-commercial | Metadata yes; notation is licensed, terms forbid copying | artist+title |
| Ultimate Guitar | No API. User GP files download by hand (logged in); Official tabs cannot be downloaded | gp3-gp5, gpx | Free/Pro | Automated access forbidden | manual only |
| Guitar Pro mySongBook | Only inside the Guitar Pro app | gp | Subscription | No API, no export to third parties | no |
| Soundslice | No catalog; you bring notation, it renders in an iframe | embed | $0.50 per user per month | Yes, but it gives nothing we lack | no |
| MuseScore.com / OpenScore / PDMX | Public domain classical only (PDMX: 250k MusicXML, CC BY 4.0) | MusicXML | Free | Yes | title+composer, no pop songs |
| Hooktheory | Aggregate chord stats only, no per-song tabs | JSON | Free | Yes | no |
| Chordify | No public API (forum request, unanswered) | none | Paid | n/a | no |
| GProTab, gtptabs, tabclub, 911tabs | User-shared GP files of copyrighted songs, no API, no license | gp | Free | Same category as scraping Songsterr | manual only |
| DadaGP | 26k GP files scraped from UG; research access by email; no license for the files | gp, tokens | Free | No (research only, unlicensed) | filenames |
| Classtab | 4000 classical guitar text tabs + MIDI, monthly zip | text, MIDI | Free | Yes (no terms stated) | composer |

Verdict:
- Nothing free gives licensed notation for popular songs by artist+title. Every legal catalog is paid and closed (Songsterr, UG Official, mySongBook), or public domain classical.
- The closest legitimate options: Songsterr metadata as hints (tuning, which instruments exist) plus the link-out; the user's own GP/MusicXML file, shared with the server; the generated tab made better.
- Public domain MusicXML (PDMX, OpenScore) is a cheap extra for classical pieces. Optional, last.

## 3. Source chain and storage

Order per track: 1. a file someone on this server added; 2. a generated tab; 3. Songsterr link-out. Songsterr metadata (tuning, instruments) is fetched first and used as hints for 2.

One PocketBase collection `tabs` (extend today's `ensure_tabs.pb.js`), one row per tab:

| Field | Purpose |
|---|---|
| `song_key` | normalized artist+title (reuse `lib/songKey`), replaces `tabMatchesTrack` (`lib/tabs.ts:116-131`) |
| `track`, `user` | which track it was added for, who added it |
| `kind` | `file` or `generated`; `format`: gp3..gp, musicxml, alphatex |
| `file` | filename in `my_music/tabs` (unchanged), generated tabs get a row too |
| `shared` | default true; the uploader can delete their own |
| `offset_ms` | sync nudge, set once, shared; local override stays in localStorage |
| `hints` | JSON: Songsterr songId, per-instrument tuning, difficulty |

Cache: the in-memory Songsterr cache stays (`route.ts:39-41`); hints persist on the row so the search runs once per song.

## 4. The viewer, Songsterr style

| Songsterr behaviour | AlphaTab 1.8.4 provides | We build |
|---|---|---|
| Tab staff with rhythm stems and beams | `display.staveProfile = Tab`, `notation.rhythmMode = ShowWithBeams`, `rhythmHeight` | Toggle: Tab, Tab+Score (`ScoreTab`) |
| Dark score matching Ember | `display.resources` (staffLineColor, mainGlyphColor, secondaryGlyphColor, barNumberColor, scoreInfoColor), CSS `.at-cursor-bar`, `.at-cursor-beat`, `.at-highlight` | Map to Ember tokens; drop `bg-white` |
| Page fills the screen, follow-scroll keeps the cursor in the upper third | `layoutMode = Page`, `player.scrollMode = Continuous`, `scrollElement`, `scrollOffsetY`, `nativeBrowserSmoothScroll = false` | Full-height host, no 60vh box |
| Fit to width on phone | `display.scale`, `stretchForce`, `barsPerRow` auto, re-render on resize (kept from `TabViewer.tsx:290-302`) | Scale 0.65 under 640px; optional `Horizontal` layout mode |
| Cursor follows the song | `PlayerMode.EnabledExternalMedia`, `output.updatePosition` (kept) | Feed every 50 ms from a rAF loop, not only on React ticks (`:344-353`) |
| Click a bar to seek | `beatMouseDown` event gives the beat and its `absolutePlaybackStart` | Replace the echo heuristics in `:239-254` with one clean seek |
| Drag the line to seek | `renderer.boundsLookup` (`staffSystems`, `getBeatAtPos`), `tickCache.findBeat`, `Beat.nextBeat`/`previousBeat` | A 24 px (44 px on touch) Pointer Events handle over `.at-cursor-beat`; a ghost line snapped to the nearest beat with its m:ss time; one seek on release, none on Escape or pointercancel; follow-scroll paused while held, edge auto-scroll; a press that never moves is click-to-seek; Left/Right step a beat when the score has focus (`lib/tabDrag.ts`, `LiveTabScore.tsx`) |
| Loop a section | `playbackRange` + `isLooping` (range math, `playbackRangeChanged`) | Two clicks on bars select the range; we enforce the jump in the external handler |
| Speed, pitch kept | `playbackSpeed` calls `handler.playbackRate` | New `setRate()` on `AudioBackend`: web `audio.playbackRate` + `preservesPitch`; Android Media3 `PlaybackParameters(speed, pitch 1)`; Tauri later |
| Count-in, metronome | Synth only (`countInVolume`, `metronomeVolume`); silent in external media mode | Small Web Audio click from the score tempo map; count-in = one bar of clicks before resuming |
| Track picker | `score.tracks`, `renderTracks([t])` (kept, `:355-360`) | Pills with instrument icon and tuning; remember choice per tab |
| Header: tempo, key, tuning, capo | `score.tempo`, `track.staves[0].tuning`, `capo` | One line above the score |
| Mute/solo instruments | Synth only | Not in scope: Ember plays one fixed mix |

Transport: none of its own. The player bar stays visible (see 6), so `TabViewer.tsx:391-426` goes.

## 5. Transcription quality

| Change | Effort | Benefit |
|---|---|---|
| Bass track from the Demucs bass stem (already separated by `htdemucs_6s`, `transcribe.py:172-174`), 4-string placement | S | High: a second real track, cheapest win |
| Downbeat estimate so bar 1 starts on a real bar (today bar = beat 0, `:89-91`) | M | High: bars line up with the recording |
| Tuning hint from Songsterr `tracks[].tuning`; else drop-D from the lowest note | S | Medium |
| Position-aware fingering (minimize hand movement) instead of lowest fret (`:39-47`) | M | Medium: playable shapes |
| Ghost note cleanup using Basic Pitch amplitude, merge sub-16th splits | S | Medium: less clutter |
| Vocal melody as a third track from the vocals stem | S | Low, nice for singing lines |
| Research models (TART, Fretting-Transformer) | L | Not worth it now: research code, GPU |

Runtime stays one job at a time on CPU (`lib/tabGenerate.ts:10-13`).

## 6. Where it lives

Today: a dialog opened from the player bar (`PlayerBar.tsx:181`), score boxed to 60vh. A tab needs the whole screen. Candidates for `/dizajn`, a new "Guitar tabs" section next to the changelog one (`dizajn/page.tsx:187-203`), rendered inside `ShellPreview` desktop and phone with a bundled sample alphaTex:

- A. Sheet page: route `/tabs/[trackId]`. Sticky toolbar on top (tracks, notation toggle, speed, loop, metronome), score fills the content column, player bar stays below. Phone: same page full screen.
- B. Side panel: desktop shows the tab in the right column like `LyricsPanel.tsx:6-11`, in horizontal layout scrolling sideways while you browse. Phone: full-screen sheet from NowPlaying.
- C. Stage: full-bleed dark score, floating translucent toolbar over the bottom edge, horizontal single-row layout like Songsterr's scroll mode, everything else hidden.

Recommended: A, with C's horizontal mode as a toggle inside it. The "Songsterr integration" plugin card (`settings/plugins/page.tsx:9-10`) becomes the on/off switch for the link-out and hints.

## 7. Stages

Each stage: tests (unit in vitest next to the code, sandbox in `tests/*.test.mjs`, browser via playwright-core, fakes so nothing needs the internet), a changelog entry, a version bump per `docs/changelog-system.md`.

| Stage | Ships | Tests | Version |
|---|---|---|---|
| 1. Store | `tabs` rows for files and generated tabs, `song_key`, `shared`, `hints`; Songsterr hints via a fake server; migration of existing rows | unit: song_key match, hint parsing; `tests/tabs.test.mjs` with a fake Songsterr | 0.3.2 |
| 2. Design | The three `/dizajn` candidates with real AlphaTab in the mock shell; owner picks | `dizajn/page.test.tsx` renders each; playwright screenshot per candidate | 0.3.3 |
| 3. Viewer core | New `TabView`: rhythm beams, dark theme, page layout, follow-scroll, click-to-seek, track picker, header, chosen home; delete `TabsDialog` transport | unit with a fake `@coderline/alphatab` module (settings, events); `tests/tabs-ui.test.mjs` with `tests/fake-player.sh` | 0.3.4 |
| 4. Practice tools | Loop range, speed (web + Android), metronome and count-in clicks | unit: range and rate math, click scheduler with a fake AudioContext; browser | 0.3.5 |
| 5. Transcription v2 | Bass track, downbeats, tuning hints, fingering, cleanup | `tests/tabs-generate.test.mjs` on synthetic wavs (bass line, offset downbeat); route via `fake-transcribe.sh` | 0.3.6 |
| 6. Optional | Public domain MusicXML lookup (PDMX), synth playback mode with mute/solo | only if asked | later |

## Decisions (owner, final)

1. Home for the tab: **A, the Sheet page** (`/tabs/[trackId]`), with C's horizontal scroll as a toggle inside it. `/dizajn` still shows A, B and C so it can be confirmed visually; A is preselected and labelled Recommended.
2. Tab files people add are **shared with everyone on the server** by default; the uploader (and admins) can delete theirs.
3. Speed control: **web first** (`audio.playbackRate` + `preservesPitch`); Android Media3 and Tauri native rate come later, after stage 4. Stage 4 ships the web rate only and hides the speed control on shells without `setRate()`.

## Stage 1 as built

- `pb_hooks/ensure_tabs.pb.js` upgrades the collection in place: adds `song_key`, `track_key` (the app's compound track id, e.g. `youtube:abc`; the old `track` relation points at PB `tracks` ids and stays unused), `kind`, `format`, `shared`, `offset_ms`, `hints`; `user` becomes optional (a generated tab recorded after the fact has nobody to name); rules: list/view `shared = true || user = me` for signed-in members, delete `user = me || is_admin`.
- Old rows: the new bool reads false, so every tab added before sharing **stays private** to its uploader. `song_key`, `kind`, `format` are filled by the web app on first read (`lib/tabStore.ts backfillTabRows`), so the normalization stays in `lib/songKey.ts`.
- `lib/tabStore.ts` is the store: lookup by `song_key` (unknown artist on either side does not veto a title match) or exact `track_key`, visibility and delete checks mirroring the rules, `orderSources` for file > generated > Songsterr, `recordGenerated`, `hintsFor`.
- Generated tabs: a row (`kind: generated`, shared, `user` = who asked) is written when the job finishes, or on the first GET of a tab generated before the store.
- Hints: `lib/songsterr.ts` parses Songsterr's `tracks[].tuning` and `difficulty`. They are stored on every row of the song; a song with a row answers from them without searching. A song with no row keeps only the in-memory cache (there is no row to hold them). `SONGSTERR_BASE` points the sandbox at `tests/fake-songsterr.mjs`.
