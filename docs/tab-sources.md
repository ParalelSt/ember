# Tab sources: paste, search, share, generate last

Plan only. Unreleased 0.3.3 work on `tabs-rebuild`. Paths are relative to `apps/web/` unless they start with `docs/`, `tests/` or the repo root.

## 1. Why

Research verdict: no free legal API gives notes for popular songs. Songsterr's public API is metadata and a link-out; Ultimate Guitar has no API and forbids automation, so Ember never fetches UG. The user copies and pastes. (Superseded by the owner's later decision: Ember now fetches UG's free text tabs itself, once per song.) Today the chain is file, generated, Songsterr link (`lib/tabSources.ts:41-47`), and generating is the only easy path. This plan adds two cheap real sources and pushes generated to the end.

## 2. The text tab parser (`lib/tabText.ts`, pure, shared by client preview and server)

AlphaTab 1.8.4 imports alphaTex, GP3-5, GP7-8, GPX, MusicXML and Capella (`node_modules/@coderline/alphatab/dist/alphaTab.core.mjs`). It has no ASCII tab importer, so we write one that emits alphaTex, the format generated tabs already use (`transcribe.py:67-115`).

| Input seen in the wild | Handling |
|---|---|
| Block of 4 to 8 lines like `e\|--3--\|`, `D\|` | Consecutive string lines form a block. 6 = guitar, 7 = 7-string, 4 or 5 = bass |
| String labels `e B G D A E`, `D A D G B E`, `B` on a 7th line | Tuning from labels, top line = string 1. Octaves from the standard layout, so bottom `D` on 6 strings = Drop D. No labels: standard for that string count |
| Frets, two digits `12`, chords stacked in one column | Same start column across strings = one beat. Off-by-one columns on a two-digit fret are merged |
| `h p / \ b r ~ x t ( )` | `{h}` `{p}` `{sl}` `{b (0 4)}` release `{b (0 4 0)}` `{v}` `{x}` `{tap}` ghost `{g}`. `7b9` bends 2 semitones. Unknown marks are skipped and counted |
| `\|`, `\|\|`, `\|:` `:\|`, `x4` after a bar or block | Bars split on `\|`. Repeats are expanded inline, so the timeline stays linear for sync |
| Lyrics, chord names, comments, `[Chorus]`, `Capo 2`, `Tempo 120`, `PM---` | Non-tab lines are ignored, except capo, tempo and a palm-mute line (`{pm}`). Section names become `\section` |
| Several blocks | Blocks concatenate in order. Two blocks with different string counts (guitar + bass) become two `\track`s: later stage |
| Rhythm letters line `W H Q E S` with `.` and `+` under or over a block | Used as durations when present (UG "rhythm" style). Otherwise: spacing rule below |

Rhythm is what most text tabs do not have. The honest rule: a bar is 16 slots of a 16th (the grid `transcribe.py:29-31` uses), a note's slot is its column position inside the bar, rests fill the gaps. So the tabber's spacing is the timing, which is how people read text tabs. Over 16 note columns in a bar: 32 slots. No bar lines at all: a bar every 16 columns, with a warning. Tempo: from a `Tempo` line if any, else the dialog (section 6). Start alignment stays the existing sync nudge, plus or minus 10 s (`lib/tabSync.ts:9`).

Output: `\title`, `\artist`, `\tempo`, `\tuning E4 B3 G3 D3 A2 E2` (scientific pitch, highest string first, same order as Songsterr hints `lib/songsterr.ts:17`; AlphaTab's `parseTuning` adds its own octave offset), `\capo`, `\instrument`, then bars of `fret.string.duration` tokens as `transcribe.py:105-111` writes them. Plus a report: strings, tuning name, bar count, note count, skipped lines with reasons, warnings (no tempo, no bar lines, N marks ignored). The dialog shows the report; a paste with zero notes is refused.

## 3. Search buttons

Links only, opened with `window.open(url, '_blank', 'noopener,noreferrer')` as `TabsPage.tsx:193` does. Nothing is fetched by the server. Helper `lib/tabSearchLinks.ts`, unit tested for encoding.

| Button | URL (`q` = `artist title`, URL-encoded) |
|---|---|
| Search Ultimate Guitar | `https://www.ultimate-guitar.com/search.php?search_type=title&value=q` (add `&type[]=500` for the Guitar Pro filter; confirm by hand once, drop if ignored) |
| Search Guitar Pro files | `https://duckduckgo.com/?q=q+(gp5+OR+gpx+OR+"guitar+pro")` |
| Open on Songsterr | The match URL from `lib/songsterr.ts:121`; with no match `https://www.songsterr.com/?pattern=q` |

## 4. Source chain and labels

Order: file, pasted, generated, then the Songsterr link in the empty state only. `orderSources` (`lib/tabSources.ts:41-47`), `drawableTabs` (`:76-90`) and `sortTabs` (`lib/tabStore.ts:86-91`) gain the middle rank. `TabKind` (`lib/tabSources.ts:7`) becomes `'file' | 'pasted' | 'generated'`.

| Kind | Chip (`sourceChipLabel`, `lib/tabSources.ts:106-110`) | In the picker (`TabsPage.tsx:321-342`) |
|---|---|---|
| file | File added by Aron, shared | Guitar Pro file, Aron, Guitar |
| pasted | Text tab pasted by Aron, shared | Text tab, Aron, Guitar |
| generated | Generated from the recording, rough | Generated, rough, last |

Generated stays a button, never automatic, and its empty-state copy says it is the last resort.

## 5. Storage

Like a file: one `tabs` row, `kind: pasted`, `format: alphatex` (the format list at `pocketbase/pb_hooks/ensure_tabs.pb.js:11-13` already names alphatex), `shared: true`, `user` = who pasted. On disk in `MUSIC_DIR/tabs`: `<stem>.alphatex` (what AlphaTab loads through the unchanged download route, `app/api/tabs/files/[id]/download/route.ts`) and `<stem>.txt` (the original paste). `resolveRowPath` (`lib/tabs.ts:85-90`) already resolves non-generated rows in `TAB_DIR`. Delete (`files/[id]/route.ts:25-33`) removes both files; same rule as files: whoever pasted, or an admin. Sync nudge shared via the existing PATCH. Because the source text is kept, `Re-parse` (menu item, and a script for admins when the parser improves) rewrites the `.alphatex`; changing the tempo later is a re-parse with a new tempo.

New route `POST /api/tabs/text` (JSON: text, title, artist, trackId, tempo, tuning override), 256 KB cap, same rate limit as files (`files/route.ts:56`). It parses server side with the same module, so the saved tab equals the preview.

## 6. UI

"Paste a tab" appears in the empty state beside "Add a file" (`TabsPage.tsx:405-410`) and in the ⋯ menu above "Add a Guitar Pro or MusicXML file" (`:186`). The empty state also gets the three search links as a row of chips and moves "Generate a tab" last with the word rough. The dialog: textarea, the report line ("6 strings, Drop D, 24 bars, 2 lines skipped"), a tempo row (number field, Tap along to the playing song, Fit to song length = bars x 4 x 60 / duration), a live AlphaTab preview from the alphaTex, Save.

Per the app's design system, two candidates go on `/dizajn` under "Guitar tabs" before the real UI, as a picker like `TABS_LAYOUTS` (`components/library/options/tabs/index.ts`):

- A. Paste dialog: a modal, textarea left, preview right, report and tempo row between them, Save in the footer. Phone: stacked. Recommended.
- B. Inline editor: the empty state turns into an editor on the tab page itself, textarea on top, preview below where the score will sit, Save in the sticky toolbar. Phone: same, stacked.

## 7. Tests

| Level | Where | Covers |
|---|---|---|
| Unit (vitest) | `lib/tabText.test.ts`, fixtures `lib/__fixtures__/tabtext/*.txt`, our own originals in these shapes | Standard 6, Drop D labels, 7-string, bass 4 and 5, stacked chords, two-digit frets, technique marks, `x4`, lyrics and chord lines mixed in, no bar lines, rhythm letters, capo and tempo lines, junk (zero notes, refused). Assert tuning MIDI array, bar count, tokens per bar, and that the alphaTex round-trips through `AlphaTexImporter` in node |
| Unit | `lib/tabSearchLinks.test.ts` | Encoding, Songsterr match vs fallback |
| Sandbox | `tests/tabs-text.test.mjs`, `npm run test:tabs-text` (add beside `package.json:29-32`) | POST, list order file > pasted > generated, download serves alphatex, delete removes both files, sharing and delete rules, size cap, re-parse |
| Browser | extend `tests/tabs-ui.test.mjs` | Paste, report line, Fit to song length, Save, the score renders, the cursor follows the fake player, chip says "Text tab pasted by", search chips carry the right hrefs (no click) |

## 8. Stages

Each lands on its own, tests green, with a bullet added to the 0.3.3 entry (`lib/changelog.ts:23-36`).

| Stage | Ships | Bullet for 0.3.3 |
|---|---|---|
| 1. Search links | `lib/tabSearchLinks.ts`, chips in the empty state and menu | No tab yet? One click searches Ultimate Guitar, Guitar Pro files or Songsterr for the song |
| 2. Parser | `lib/tabText.ts`, fixtures, unit tests, no UI | none (internal) |
| 3. Store and route | kind pasted, `POST /api/tabs/text`, chain order, chip labels, sandbox test | none yet |
| 4. Design | Candidates A and B on `/dizajn`; owner picks by name | none |
| 5. Paste UI | The chosen dialog, tempo tap and fit, preview, browser test | Paste a text tab from anywhere and Ember turns it into a real tab that follows the song |
| 6. Later | Rhythm letters, guitar + bass in one paste, chord names as beat text, admin re-parse script | as they land |

Worker tier: sonnet-worker for stages 1, 3, 4 and 5; opus-worker for stage 2 (the parser and its fixture set).

## Decisions for the owner

1. Timing when the text has no rhythm: column spacing on a 16th grid, or evenly spaced notes per bar? Recommended: spacing, it matches how tabbers write.
2. Tempo when the text has none: default to Fit to song length, with Tap as the alternative? Recommended: yes, fit by default.
3. Generated tabs: keep the button, or run automatically when a song has nothing else? Recommended: keep the button, labelled rough and last.
