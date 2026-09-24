# Auto cache, release check (web 0.7.4, shells 0.4.3)

Taken by `tests/auto-cache-ui.test.mjs` (`SHOTS_DIR=docs/reports/auto-cache`)
against a throwaway build of `release-autocache` (app 3053, scratch
PocketBase 8086). Three uploaded songs, A 20 s, B 8 s, C 8 s; B and C were
cached while A played, then the browser went offline.

| File | What it shows |
|---|---|
| `auto-cache-offline-1280.png` | Desktop bar, offline mid-A: the small "Offline" pill beside the song (its label reads "Offline, playing cached songs"). |
| `auto-cache-offline-390.png` | Phone bar, same moment: "Offline, playing cached songs" in place of the artist. |
| `auto-cache-offline-stalled.png` | Desktop, C's file removed and B finished: the stalled state and the one toast. |
| `auto-cache-settings-1280.png` | Settings > Downloads: "Cache upcoming songs" (on), "Also on mobile data" (off), the space used and "Clear cached songs". |
| `auto-cache-settings-390.png` | The same rows on a phone. |

Result: 17/17 checks passed, including Clear emptying the cache. The badge
and the rows are the plain versions from Task 5; a /dizajn pick can restyle
them later.
