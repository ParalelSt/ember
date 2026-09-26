# Bug hunt 2026-09-25: shared player layer, web side

Branch `bughunt2/web-player`, off main at web 0.7.11 (`b750003`). Scope: PlayerProvider and hooks/player, lib/playback (web, capacitor and the TypeScript side of the desktop bridge), queue, shuffle and repeat, the stream and loudness routes, auto cache, Discord timing, practice speed and loop, the player bars. Items already in `docs/reports/bughunt-2026-09-24/` (P01 to P12, A3, A6 to A8) were not re-reported.

Method: code reading, a failing vitest test first for every fix, then the fix. A local dev server was tried for the loudness route's id decoding, but webpack dev in a worktree cannot build `node:` imports; Next's route matcher was read instead (it decodes params, so that route is fine).

**Found 14, fixed 9.** Unit suite after the fixes: 298 files, 3441 tests, all passing (baseline before: 292 files, 3416 tests).

| id | severity | what you'd notice | status |
|----|----------|-------------------|--------|
| P1 | medium | two quick skips land on the same song | fixed `69e4708` |
| P2 | medium | turning shuffle off drops or brings back songs | fixed `7a813e0` |
| P3 | low | loop-all runs one song into radio after a playlist edit | fixed `7a813e0` |
| P4 | medium | desktop: media keys dead after the engine falls back to web audio | fixed `69e4708` |
| P5 | low | a song that finished shows "Couldn't load" and the queue stops | fixed `69e4708` |
| P6 | low | uploads: wrong bytes for a "last N bytes" request, 416 for an end past the file | fixed `69fdb46` |
| P7 | low | play pressed early on a cold start starts the song at 0:00, not where you left off | fixed `7cce37f` |
| P8 | low (dev) | desktop dev build: one song ending skips two | fixed `e07dd05` |
| P9 | high | tapping a song in the queue wipes a search queue, turns shuffle off | fixed `a7924bc` |
| P10 | low | Discord card at practice speed, and one update per loop pass | not fixed |
| P11 | low | old Android APK: notification bar drifts at practice speed, lags after a seek | not fixed |
| P12 | low | web: one song that will not load stops the whole queue | not fixed |
| P13 | low | shuffle after radio took over mixes radio into what loop-all loops | not fixed |
| P14 | low | a failed radio fetch ends the queue in silence, no message | not fixed |

---

## P1. Two quick skips landed on the same song
**Severity:** medium.
**What you'd notice:** in a carlist session two guests press skip within one poll, and only one skip happens (the same song loads twice). The same for two media-key presses delivered in one task, and for a radio append followed by an immediate skip on the last song (the skip did nothing).
**Why it happened:** `next`/`prev` built their navigation state from the queue and index of the last render (`navState` in PlayerProvider closed over them). Only loop mode, context and baseCount were read live. Two calls before React re-rendered both started from the same index.
**What changed:** `navState` reads the queue and index from the store at call time, like the rest. `apps/web/components/player/PlayerProvider.tsx`.
**Test:** `components/player/PlayerProvider.bh2.test.tsx` (P1 block, 3 tests). Before: `expected 1 to be 2`, `expected 2 to be 1`, and the radio-append case stayed on the last song. After: pass.

## P2. Turning shuffle off restored an out-of-date queue
**Severity:** medium.
**What you'd notice:** with shuffle on, songs a carlist session added disappear when you turn shuffle off; a song you removed from the playing playlist comes back; a song flagged unavailable loses its grey-out and gets tried again.
**Why it happened:** `toggleShuffle` put back the pre-shuffle snapshot (`orderBackup`) wholesale. Only the radio append kept the snapshot in step (bughunt P08 era); the session host append, the playlist removal and the availability flag did not.
**What changed:** the snapshot now only decides the order: shuffle off takes the live queue, orders it by the snapshot, keeps anything added since at the end, drops anything removed, uses the queue's current copy of each song, and matches a song listed twice copy by copy (`restoreOrder` in `apps/web/stores/usePlayerStore.ts`).
**Test:** `stores/usePlayerStore.shuffle.test.ts` (5 tests; the added, removed and flag cases fail before).

## P3. Removing a playlist song moved the loop-all wrap point
**Severity:** low.
**What you'd notice:** a playlist has run into radio; you remove one of its songs; with loop-all on, playback now plays the first radio song before going back to the top.
**Why it happened:** the removal took the song out of the live queue but left `baseCount` (the size of the playlist part, which is where loop-all wraps) as it was.
**What changed:** `baseCount` shrinks by one when the removed entry was inside it. `apps/web/hooks/useLibrary.ts` (useExecuteRemoveFromPlaylist).
**Test:** `hooks/useLibrary.removeFromPlaylist.test.tsx`. Before: `expected 4 to be 3`.

## P4. Desktop: media keys stopped working after the web-audio fallback
**Severity:** medium (desktop).
**What you'd notice:** when the desktop engine fails on a song and the app retries it on web audio (or goes to web audio for a downloaded song while offline), the keyboard media keys and the OS media widget do nothing for the rest of the session.
**Why it happened:** `useRemoteCommands` wired the transport commands once, when the first backend was built (`backendReady`). The engine swap builds a new backend that never got them. The comment in the fallback says a dead native engine may cost the native media keys, but the web backend has its own (MediaSession, which WebView2 and WKWebView both support), and they were simply never registered.
**What changed:** `useRemoteCommands` takes the engine kind and re-registers when it changes. `apps/web/hooks/player/useRemoteCommands.ts`, `PlayerProvider.tsx`.
**Test:** `PlayerProvider.bh2.test.tsx` (P4). Before: the new web backend's `setRemoteCommands` was never called. After: it is, and its Next moves the queue.

## P5. A finished song was treated as a failure
**Severity:** low (needs a catalog length more than 10% longer than the real file).
**What you'd notice:** a song plays to its end, then "Couldn't load ..." appears and the queue stops instead of moving on.
**Why it happened:** `onEnded` treats an end more than 5 s short of the known length as a dead stream and runs the error path. The known length comes from `chooseDuration`, which keeps the catalog's figure when the engine's differs by more than 10%. On web audio the element's length is read from the file itself, so such an end is real.
**What changed:** on web and capacitor engines an end at the element's own length counts as a real end. The desktop decoder's length is still not trusted. `PlayerProvider.tsx` (onEnded).
**Test:** `PlayerProvider.bh2.test.tsx` (P5, 2 tests: the real end advances; an end well short of the file still runs the error path).

## P6. Uploads and prank sounds: byte ranges
**Severity:** low.
**What you'd notice:** a member upload that fails to play or seek in a player that asks for the end of the file first, or asks for a range ending past the file.
**Why it happened:** `lib/serveFile.ts` (uploads and prank media) read `bytes=-N` as "from 0 to N" and refused any end past the file with 416. Bughunt P10 fixed both in the YouTube stream route's own copy, not in this shared one.
**What changed:** the same rules as P10: a suffix range serves the last N bytes, an end past the file is clamped (RFC 9110), a start past the end and `bytes=-0` stay 416. `apps/web/lib/serveFile.ts`.
**Test:** `lib/serveFile.test.ts` (5 tests; 4 fail before, e.g. `expected 'bytes 0-10/100' to be 'bytes 90-99/100'`).

## P7. Web audio: play pressed before a song loaded lost its start position
**Severity:** low.
**What you'd notice:** open the app on a slow connection, press play straight away, and the song you left at 1:35 starts at 0:00.
**Why it happened:** `play()` on an element with no data yet rebuilds it and resumes at the last playhead the element reported. A load still waiting for its metadata has not reported one, so that was 0 (or the previous song's time), and it replaced the pending restore of the load's own start point.
**What changed:** the rebuild resumes at the pending load's target when there is one, and `load()` resets the remembered playhead to the new song's start. `apps/web/lib/playback/webBackend.ts`.
**Test:** `lib/playback/webBackend.test.ts`, "play() before the song has loaded" (2 tests). Before: `expected +0 to be 95`.

## P8. Desktop bridge: event subscriptions that resolve after destroy stay wired
**Severity:** low; in practice the dev build (React's double mount under StrictMode, the Next default).
**What you'd notice:** in a dev desktop build, every engine event arrives twice: one song ending skips two, time updates double.
**Why it happened:** `listen()` is asynchronous. `destroy()` only removed subscriptions that had already resolved; a later one was pushed into a list nobody read again and kept calling the provider.
**What changed:** a destroyed backend unsubscribes late arrivals at once and ignores events. `apps/web/lib/playback/tauriBackend.ts`.
**Test:** `lib/playback/tauriBackend.destroy.test.ts`. Before: `onEnded` called after destroy.

## P9. A tap in the queue sheet started a new queue
**Severity:** high (common action, visible damage).
**What you'd notice:** play a search result, let radio fill the queue, open the queue and tap the fifth song: the queue collapses to that one song. With shuffle on, tapping any upcoming song turns shuffle off and its original order is gone. In a playlist that ran into radio, loop-all now loops the radio songs too. A song listed twice jumps to its first copy.
**Why it happened:** the queue sheet called `playTrack(t, queue, context)`, which builds a new queue: for a search context it keeps only the tapped song, and it always resets shuffle, the shuffle snapshot and `baseCount`, and finds the tapped song by id.
**What changed:** a new `playAt(index)` on the player moves to that queue entry (through the same walk Next uses, so unavailable and offline songs are still passed over) and leaves the queue, context, shuffle and loop point alone. The queue sheet uses it. `PlayerProvider.tsx`, `components/player/QueueSheet.tsx`.
**Residual:** on the native Android engine the provider still tells the phone's player which song to start by id, so a song listed twice starts at its first copy there.
**Tests:** `PlayerProvider.bh2.test.tsx` (P9, 3 tests) and `components/player/QueueSheet.test.tsx` (the sheet calls `playAt(2)` for the upcoming copy, not `playTrack`).

---

## Not fixed

### P10. Discord card during practice (low)
The tab page's loop jumps back every pass; `useDiscordPresence` counts any jump of 2.5 s or more as a seek and publishes, so a loop of 3 to 4 s sends a presence update per pass. At practice speed the card's time bar also runs at full speed, since presence carries no rate. The server route coalesces to one update per 15 s, so the web side is harmless; the desktop's local Discord client gets every update (whether the Rust side throttles is for the desktop audit). Not fixed: scaling the card by the rate needs a presence contract change, and the loop publishes are only a concern if the Rust side does not throttle.

### P11. Old Android APK (media-session plugin): practice speed and seeks on the notification (low)
`capacitorBackend` always sends `playbackRate: 1` in `setPositionState`, and a seek's position goes through the 1 s throttle instead of being pushed at once. At practice speed the notification's bar runs ahead between updates; after a seek it lags up to a second. Not fixed: only APKs without the Media3 player, which cannot be verified here.

### P12. Web: one song that will not load stops the queue (low, product decision)
When a song fails and the server says it is not dead, the web player stops with "Couldn't load ..." rather than moving on, even during an unattended auto-advance. Android now moves on (A3, with a 5-failure cap). Not fixed: whether to skip on web is a product decision, and a skip there wants the same failure cap.

### P13. Shuffle with a radio tail mixes radio into the loop (low)
`baseCount` is positional (the first N entries are the playlist). Turning shuffle on while inside the playlist after radio has already extended it shuffles radio songs into the first N positions, so loop-all then loops some radio songs and never reaches some playlist songs. Not fixed: needs a decision on what loop-all means in a mixed, shuffled queue (for example shuffling the playlist part and the radio part separately).

### P14. A failed radio fetch ends the queue silently (low)
On the last song, radio is fetched once. If that request fails, the song ends and playback just stops, with no message, and nothing retries until the history list changes. Not fixed: the right behaviour (retry at the end, or say "Couldn't find more songs") is a product choice.

---

## How to run the tests

```
cd apps/web
npx vitest run components/player/PlayerProvider.bh2.test.tsx components/player/QueueSheet.test.tsx \
  stores/usePlayerStore.shuffle.test.ts hooks/useLibrary.removeFromPlaylist.test.tsx \
  lib/serveFile.test.ts lib/playback/webBackend.test.ts lib/playback/tauriBackend.destroy.test.ts
npx vitest run   # whole suite
```
