# Device remote control (Ember Connect)

Plan only. No code in this document. Written 2026-11-08, revised the same
day with the owner's four answers (section 7), for this request:

> "sync the current playing song per device meaning while I am listening on
> for example windows that I open the phone app and see that song is playing
> and I can pause it with my phone as well or swap or whatever else there is
> from the controls."

Same account, several devices. One device plays. Another device opens the
app, sees that song as playing "on Windows", and its player controls drive
the device that plays. Picking a device in the existing output picker moves
the music there. Spotify Connect, scoped to one account's own devices.

Worktree: `/Users/aronmatoic/Documents/Main Projects/spotify-clone-wt/error-reports-1105`.
Branch: a new feature branch from `main` (`npm run branch`), never `main`.
Do not touch `pocketbase/pb_data`. Never run `npm install` in a worktree.

## 1. Recommendation

Build it as a **remote AudioBackend**, the way casting already works.

- The device that plays is the **player**. It sends a small heartbeat
  (what it plays, where, playing or paused) to the Next server and gets any
  pending commands back in the same answer.
- A device that opens the app while another one is active becomes a
  **controller**. Its PlayerProvider swaps the local engine for a
  `remoteBackend`, exactly as it swaps to `castBackend` today
  (`components/player/PlayerProvider.tsx` lines 943 to 1010). Every control
  the UI already has (play, pause, next, previous, seek, volume, shuffle,
  loop, queue sheet, a tap on a song in the library) keeps calling the
  provider; the remote backend turns those into commands and turns the
  player's snapshots into the backend events the provider already
  understands.
- **Devices live in the existing output picker** (`lib/outputs/rows.ts`,
  `lib/outputs/controller.ts`, `DevicesButton` / the phone's Devices
  sheet), next to speakers and cast devices. Picking another Ember device
  there **moves the music to it**; picking a local output while controlling
  brings the music back here. Handover rules follow `castSwitch.ts`.
- State lives in **server memory** (one Next process, see
  `start-static.sh` and `deploy/ember.service`), like
  `lib/pranks/presence.ts`. No PocketBase collection, no DB writes per beat.
- **One device at a time.** Starting playback on a second device pauses the
  first (owner decision 1).
- On Android, while the phone controls another device, the phone shows a
  **media notification and lock-screen controls** that drive the remote
  device (owner decision 3). Media3 makes this a player swap inside the
  existing service, not a second notification system.

Why this shape:

1. The cast backend proves the provider can drive an engine that plays
   somewhere else, and `gateEvents` / `localBackendRef` / `castHandover`
   already solve the stale-event and hand-over problems.
2. The Android backend proves the provider can follow a queue it does not
   own (`onQueueIndex`, `onQueueReplaced`, `setQueue?()`, `next?()`,
   `prev?()`). A remote device is a queue-owning backend whose "native
   side" is another computer. A tap in the library already flows into
   `b.setQueue(...)` for such a backend (`PlayerProvider.tsx` lines 834 to
   858), which is how "play it on Windows" comes almost for free.
3. Polling through Next is the only transport that works on the host today.
   PocketBase realtime does not stream through the `/pb` rewrite under
   `next start` (`hooks/pranks/usePrankInbox.ts` lines 74 to 81,
   `tests/pranks-realtime.spike.mjs`). Pranks already poll every 2.5 s while
   music plays, so the budget below is not new load.
4. The output picker is where the owner looks for "where does it play"
   already (cast devices, headphones). One list, one lit row.

### Alternatives weighed

| Option | Why not (now) |
|---|---|
| PocketBase realtime subscriptions on a `device_state` collection | SSE never arrives through `/pb` on the host. Would also mean a DB write per heartbeat. Keep as an opt-in upgrade later, same flag pattern as `NEXT_PUBLIC_PRANKS_REALTIME`. |
| PocketBase collection for commands (like `session_commands`) | Works, but a row per button press and a cleanup job for a 20 s TTL. The in-memory store does the same with zero writes. Keep the store behind an interface so a PB-backed one can replace it if the host ever runs two processes. |
| Peer to peer (WebRTC) between devices | Host is behind Tailscale Funnel, phones roam networks, and the server already sees both devices. Not worth the signalling. |
| Transfer only ("Play here"), no remote control | Does not match the request: the owner wants to pause Windows from the phone, not only move the music. Both are in. |
| A separate Devices picker for Ember devices | Owner wants them in the output list. One picker also gives the transfer gesture (pick a row, the music moves) for free. |
| A separate "remote" UI instead of swapping the backend | Every player surface reads `usePlayer()` and `usePlayerStore`. A parallel view model touches all of them; the backend swap touches none. |
| A plain Android notification for the controller (no MediaSession) | No lock-screen controls, no headset buttons, hand-built actions. A `SimpleBasePlayer` behind the existing `MediaSession` gives all of it with Media3's own notification. |

## 2. Behaviour decisions

**Which device is active.** Pure rule `pickActive(devices, now)`:
among devices whose last beat is fresh (within 35 s), the one that is
playing with the newest `changedAt` (when its play state last changed).
If none plays, the paused one with the newest `changedAt` inside a 2 minute
takeover window. Else none, and the opening device plays locally as today.

**One device at a time (decided).** When device B starts playing while A
is active and fresh, the server queues `pause` (reason `took-over`) to A
on its next beat. A shows a short toast "Paused: playing on Android
phone". No flag, no setting.

**Controller attach.** On app open, on return from hidden, and whenever
the device list changes: if an active device exists, it is not me, and I
am not playing locally, enter remote mode automatically. If I am playing
locally, stay local but list the other device in the output picker.
Pure rule `decideAttach(me, active, localPlaying)`.

**Tapping a song while controlling (decided: plays on the remote).**
The remote backend is queue-owning, so the provider hands the new queue to
`remoteBackend.setQueue(tracks, index, play, origin, startSec)`, which
posts a `setQueue` command. The remote device replaces its queue and
plays. Payload bound: the tapped song and the next 299 tracks travel as
full `Track` objects (about 120 KB worst case), plus the `context`, so
the remote's radio extension and loop still know where the queue came
from. Songs before the tapped one are dropped, so Previous on the remote
cannot go further back than the tapped song for that list. The full-queue
relay in L2 lifts this later. Also `playAt(index)` for a tap in the queue
sheet, and `addToQueue` for Play next / Add to queue.
Interim, only if W9 misses the first merge: the phone takes over and plays
locally, Windows pauses (the takeover rule).

**Moving the music (decided: through the output picker).**
Rows for the account's other fresh devices sit in the picker in a section
"Your devices", between this device's outputs and the cast section. The
row of the device playing is lit, the same way the cast row is lit while
casting.
- Local is playing, pick "Windows": `setQueue` to Windows with my queue
  (capped as above, cut at the current song), `startSec` = my position,
  `play` = my `isPlaying`. Then enter remote mode. My engine stops. Pure
  `remoteHandover()` beside `castHandover()`.
- Controlling Windows, pick a local output (or the "This phone" row):
  `pause` to Windows, leave remote mode with the remote's current song,
  its next 20 and its context, at the extrapolated position, playing if it
  was playing (`localHandover` style, but playing state is kept because
  the user asked for the move). The queue I backed up on attach is
  discarded: a move means adopting the queue. Then the chosen output is
  selected, as `chooseOutput` already does after stopping a cast.
- Controlling Windows, pick "Android phone": `setQueue` to the phone with
  what I have (current, next 20, context, position). Windows pauses by
  the takeover rule. The 20-track limit is stated in the row's toast
  ("Moved to Android phone").
- Picking the lit row does nothing.
- Cast rows keep their meaning. Casting while controlling first brings the
  music here (as `chooseOutput` does), then casts.

**Leaving remote mode without a move.** The active device goes stale (no
beat for 35 s) or an older build without W9 starts local playback. The
controller restores the local queue, index and position it backed up when
it attached, so a controller never loses its own queue by accident.

**Stale and offline.** A device unseen for 35 s is "last seen 40 s ago"
(greyed) in the picker for 10 minutes, then dropped. Commands to a stale
device answer 409 "Windows is not reachable" and the controller shows that
in a toast. Commands expire server side after 20 s, so a pause pressed
while the laptop slept does not fire when it wakes. The controller applies
each command optimistically to its mirrored state and reverts if the next
snapshot still disagrees after 4 s.

**Latency target.** Command visible on the player within 1.5 s (p50 under
1 s), player state visible on the controller within 1.5 s. A `setQueue`
move is heard on the other device within 3 s. A long poll on the beat is a
later upgrade that would bring commands under 300 ms.

**Cadence (pure constants in `lib/remote/cadence.ts`).**

| Who | When | Interval |
|---|---|---|
| Player | playing, a controller polled within 6 s | 1.5 s |
| Player | playing, nobody watching | 10 s |
| Player | paused, inside the 2 min window | 30 s |
| Player | state change (play, pause, seek, track) | at once, 300 ms debounce, burst cap 8 per 30 s (as `usePresenceHeartbeat`) |
| Controller | in remote mode, page visible | 1.5 s |
| Controller | picker open | 3 s |
| Controller | app open or back from hidden | once |
| Android controller, screen off (native, A3) | lock-screen session alive | 10 s, back to 3 s the moment the screen turns on |
| Anyone else | page hidden and not the player | nothing |

Beats are light (position, playing, track id, index, queue hash, volume,
about 200 bytes). The server asks for a full snapshot (`want: 'full'`)
only when the track id or queue hash differs from what it holds, or after
a restart. A full snapshot is the current `Track`, the next 20 tracks,
queue length, duration, loop, shuffle, context, about 10 KB.

**Host load.** Worst case one playing device with one controller: about
1.3 requests per second of in-memory work, no DB. Twenty users all doing
it at once: 26 req/s, under the pranks inbox poll that already runs for
every playing member. Idle players (nobody watching) cost 0.1 req/s. A
`setQueue` command is the one big body (up to about 120 KB), rate limited
to 20 per minute per user. Memory per user under 200 KB (one pending
`setQueue` at a time per target; a newer one replaces an older unsent
one).

**Security.** Every route goes through `requireUser()`; the store is keyed
by the session's user id, never by a body field. Device ids follow the
`user_devices` rule (`^[A-Za-z0-9_-]{8,64}$`, `lib/versions/store.ts`).
Only the account's own devices are ever listed or commanded: there is no
cross-user surface and no admin view. Command types and arguments are
whitelisted and bounded (`seek` 0 to 86400, `setVolume` 0 to 1, `playAt`
0 to queue length, `setQueue` at most 300 tracks and each track shaped by
`mapTrackRow`-style validation of the `Track` fields). Rate limits per
user: beat 90/min, state 90/min, command 60/min, `setQueue` 20/min
(`lib/rateLimit.ts`). Labels are sanitized and cut to 60 characters.
Nothing from the store is logged with track titles.

**What the phone shows.** Mini player and full player show the remote
track, position, and play state as if local. `playingOn()` in
`lib/outputs/rows.ts` gains a third source: "Playing on Windows", shown
where "Playing on Living Room TV" shows today (under the full-screen
player, the Devices button tooltip). The picker's "Your devices" section
is described above. The queue sheet shows "Up next on Windows" from the
snapshot's 20 tracks. Slice 1 keeps the volume slider and party mode
hidden while controlling from a phone (as today, `hasVolumeSlider`); from
a desktop controller the slider sets the remote device's volume (same
rule as cast: only a change is sent).

**Device names (decided: platform words).** "Windows", "macOS", "Linux",
"Android phone", "iPhone", "Browser" from `lib/versions/label.ts`, with
"(Chrome)" or similar appended for browsers when two browsers of the same
platform are listed. Cast devices keep their own names. A rename field is
not planned.

**Android lock screen and notification (decided: yes for the controller).**
- Phone is the player, Windows controls it: unchanged. The Media3 session
  in `EmberPlaybackService` already reflects every pause and skip, so the
  notification and lock screen follow for free.
- Phone is the controller: the service swaps the `MediaSession`'s player
  from ExoPlayer to a `RemotePlayer` (a Media3 `SimpleBasePlayer`) whose
  state is the remote snapshot: title, artist, artwork URL, duration,
  position, playing. Media3's own notification and the lock screen show
  it; play, pause, next, previous and seek on them post commands through
  `ServerApi`. Headset and Bluetooth buttons come with it. While the
  webview is frozen (screen off), the service polls `/api/remote/state`
  itself on the cadence above and keeps the player's state current, so
  the lock screen is right when the screen wakes. The foreground service
  stays up while the remote plays, as it does for local playback, and
  lets go when the remote pauses for the usual guard time.
- Android Auto: the car sees the same session, so the car's controls also
  drive the remote device. Accepted and noted, not designed around.
- Until A3 and A4 land (slice 2), a phone that controls another device
  shows nothing on the lock screen; the app in the foreground is the
  remote.
- The web layer must not push a queue to the native ExoPlayer while
  controlling. The backend swap guarantees this: `backendRef` points at
  the remote backend, the Android backend waits in `localBackendRef` with
  an empty queue.

**Who records plays.** The player device only. The controller's
`recordPlay` path is skipped the way it is for the Android backend
(`PlayerProvider.tsx` line 1067).

## 3. Data model and transport

No PocketBase changes. Server store in `apps/web/lib/remote/store.ts`,
process wide on `globalThis` like `presenceStore()`.

```
UserRemote {
  rev: number                       // bumps on any change except position
  devices: Map<deviceId, DeviceEntry>
}
DeviceEntry {
  deviceId, label, platform, shell: 'web' | 'android' | 'tauri'
  lastBeat: number                  // server clock
  lastWatch: number                 // last GET /state from this device
  snapshot: Snapshot | null
  pending: Command[]
}
Snapshot {
  track: Track | null, index, queueLength, upNext: Track[] (max 20)
  queueHash: string
  position, duration, isPlaying, changedAt
  volume, muted, loopMode, shuffle, context
  at: number                        // server clock when received
}
Command { id, type, args, issuedBy: deviceId, issuedAt, expiresAt }
type: 'play' | 'pause' | 'next' | 'prev' | 'seek' | 'setVolume'
    | 'setLoop' | 'setShuffle' | 'playAt' | 'addToQueue'
    | 'setQueue' { tracks: Track[] (<= 300), index, play, startSec, context }
```

Routes (all `requireUser`, `withRequestLog`, `rateLimitResponse`):

- `POST /api/remote/beat` body `{ deviceId, label, platform, shell,
  light | full, acked: string[] }` answers
  `{ now, commands: Command[], watchers, active, want?: 'full',
  yield?: true }`. Removes acked commands. Runs the takeover rule.
- `GET /api/remote/state?device=<id>&rev=<n>` records the watcher and
  answers `{ now, rev, active, devices: [...] }`. Same `rev`: devices carry
  only `position`, `isPlaying`, `at` (light answer).
- `POST /api/remote/command` body `{ target, type, args }` answers
  `202 { id }`, `409` when the target is stale, `400` on a bad body,
  `413` when a `setQueue` carries more than 300 tracks.

Device identity reuses `ember.device.id` from `lib/versions/device.ts`
(export a `deviceId()` there).

Clock: every answer carries `now`. Controllers extrapolate
`position + (now_local - at - offset) * isPlaying` and write it through
`reportPosition` so the seek bar runs between polls (same `positionAt`
idea the tab page uses).

## 4. Tasks

Each task lists the automated tests that must land with it. Vitest unit
tests live beside the code (`tests/README.md`, "Unit tests"). Route tests
follow `app/api/listening/route.test.ts` (mocked `requireUser`). The
sandbox e2e test follows `tests/pranks-ui.test.mjs` (two Playwright
contexts, same sandbox) and gets a `test:remote-ui` script in
`package.json`. `npm run test:no-em-dashes` covers this document.

### Web (apps/web)

**W1. Server store and rules** (`lib/remote/types.ts`, `lib/remote/store.ts`,
`lib/remote/parse.ts`). Store, `pickActive`, `decideTakeover` (always on),
pruning (stale 35 s, drop 10 min, command TTL 20 s), light/full merge with
`want: 'full'`, rev bumping, one pending `setQueue` per target, parse and
bound every body including each `Track` inside `setQueue`.
Tests: `store.test.ts` (active choice table: playing beats paused, newest
changedAt wins, 2 min window, stale excluded; takeover queues one pause to
the old device; acked commands removed; expired commands dropped; light
beat with a new track id asks for full; rev stable on position-only beats;
a second `setQueue` replaces the first unsent one), `parse.test.ts` (every
field bounded, bad device id rejected, unknown command type rejected, seek
and volume ranges, 301 tracks rejected, a track missing `streamUrl`
rejected).
Tier: sonnet-worker.

**W2. Routes and API client** (`app/api/remote/{beat,state,command}/route.ts`,
`lib/api.ts` `api.remote.*`). Tests: one `route.test.ts` per route: 401
without a session, 429 over the limit (command and the tighter `setQueue`
limit), the store keyed by the session user and never by the body, a
second user never sees the first user's devices, 409 for a stale target,
413 for an oversized queue, 202 and the command visible in the target's
next beat, `rev` light answer.
Tier: sonnet-worker.

**W3. Client cadence, snapshot, extrapolation, handover**
(`lib/remote/cadence.ts`, `lib/remote/snapshot.ts`,
`lib/remote/extrapolate.ts`, `lib/remote/attach.ts`,
`lib/remote/handover.ts`). `nextBeatDelay(state)`,
`buildSnapshot(storeState)` with a stable `queueHash`, `lightOf(snapshot)`,
`extrapolate(snapshot, now, offset)`, `decideAttach(me, active,
localPlaying)`, `queueForTransfer(queue, index, cap)` (cut at the current
song, 300 max), `remoteHandover(local)` and `hereHandover(snapshot, now)`
(what plays, where, playing or not, when the music moves either way).
Tests: cadence table, hash stable across position changes and different
across reorders, extrapolation stops at duration and while paused, attach
decisions (idle phone attaches, playing phone does not, own device never),
transfer cut and cap, handover keeps the playing state and the position in
both directions.
Tier: sonnet-worker.

**W4. Player link hook** (`hooks/player/useRemoteLink.ts`). The player's
heartbeat: beats on cadence and on state change (debounce, burst cap,
singleton per page via `claimSingleton`, backoff via `createBackoff`),
sends `acked`, executes received commands through the provider's control
refs (the `useRemoteCommands` pattern): play, pause, next, prev, seek,
volume, loop, shuffle, `playAt(index)`, `addToQueue`, and `setQueue` via
`playTrack(tracks[index], tracks, context)` with `requestStartAt(startSec)`
and the `play` flag. Honours `yield` by pausing with a toast, answers
`want: 'full'`. Does not skip beats when `document.hidden` (the player may
be a minimized desktop window). Off when the native shell owns the link
(A2, T1).
Tests: `useRemoteLink.test.ts` with a fake `api.remote.beat`: cadence
switches from 10 s to 1.5 s when `watchers > 0`, a pause command calls
pause once and is acked on the next beat, duplicated command ids run once,
`setQueue` calls `playTrack` with the right list, index, context and start
position and starts paused when `play` is false, `yield` pauses and
toasts, 429 backs off, full snapshot sent on `want`.
Tier: sonnet-worker.

**W5. Remote backend and devices hook** (`lib/playback/remoteBackend.ts`,
`stores/useRemoteStore.ts`, `hooks/player/useRemoteDevices.ts`).
`createRemoteBackend(events, link)` implements `AudioBackend` as a
queue-owning engine: `load` no-op, `play/pause/seek/setVolume/setLoop/
setShuffle/next/prev` post commands and apply optimistically, `setQueue`
posts `setQueue` (through `queueForTransfer`) and `back(index)` posts
`playAt`, snapshots drive `onTime/onDuration/onPlay/onPause/
onQueueReplaced/onQueueIndex/onLoopMode/onShuffle`, `isPaused/
getCurrentTime/getDuration` answer from the extrapolated snapshot,
`isTransitioning` true while a command waits for its snapshot, revert
after 4 s with a toast. The devices hook polls `/state` on the controller
cadence, keeps `useRemoteStore` (devices, active, mode
`local | controlling`, target, offset), runs `decideAttach`, and is off
when the native shell is the state source (A4).
Tests: `remoteBackend.test.ts` with a fake link (each control posts the
right command once; `setQueue` posts a capped list cut at the index; a
snapshot after `pause` with `isPlaying: true` reverts; a new track in the
snapshot fires `onQueueReplaced` with the 20 tracks and `onQueueIndex`;
events stop after `destroy`), `useRemoteDevices.test.tsx` (poll cadence,
hidden page polls nothing, auto-attach only when idle, stale active leaves
remote mode).
Tier: sonnet-worker.

**W6. PlayerProvider remote mode and moves** (`components/player/
PlayerProvider.tsx`). `startControlling(deviceId, opts: { transfer?:
boolean })` and `stopControlling(opts: { adopt?: boolean })` next to
`startCasting`/`stopCasting`: back up `{queue, index, position}` to a ref,
stop the local engine, park it in `localBackendRef`, set `backendRef` to
the remote backend, gate events like cast. With `transfer`, first post
`setQueue` from `remoteHandover`. On stop with `adopt`, load the remote's
current song and up-next at the handover position, playing if it was;
without `adopt`, restore the backup, paused. Introduce `ownsQueue()` =
Android kind or controlling, and go through the 16
`backendKindRef.current === 'android'` checks (lines 289, 324, 380, 440,
580, 834, 1040, 1056, 1067, 1122, 1185, 1201, 1218, 1245, 1322, 1535):
remote behaves as Android for next/prev delegation, the queue push and
`setQueue` on a library tap, no local load, no `recordPlay`, no auto
cache, no offline stall toast, and must never call the Android `setQueue`
while controlling. Expose `moveTo(deviceId)` and `moveHere()` in the
player context for the picker. Add `BackendKind` `'remote'` for the logger
context only. Mount `useRemoteLink` and `useRemoteDevices`.
Tests: `PlayerProvider.remote.test.tsx` (mocked backends, pattern of
`PlayerProvider.cast.test.tsx`): attaching stops the local engine and
leaves the Android `setQueue` uncalled; the store shows the remote track
and position; `toggle()` posts `pause`; `next()` posts `next` and does not
touch the local queue; `playTrack` while controlling posts `setQueue` and
keeps controlling; `moveTo` posts `setQueue` with the local queue cut at
the current song and the local position, then controls; `moveHere` posts
`pause`, plays the remote song locally at the extrapolated position and
drops the backup; a stale active device restores the backed-up queue,
index and position; `recordPlay` is not called while controlling.
Tier: opus-worker (multi-subsystem, per the Ember routing note).

**W7. Output picker rows and "Playing on"** (`lib/outputs/rows.ts`,
`lib/outputs/controller.ts`, `components/player/DevicesButton.tsx` and the
phone's Devices sheet, `components/player/NowPlaying.tsx` only if
`playingOn` is not already its source). New `DeviceSection` key
`'devices'` titled "Your devices" between outputs and cast, a row per
fresh device (icon by platform: computer, phone, tablet; detail "Playing"
or "Last seen 40 s ago"), the one playing lit and local output rows not
current while controlling (as with `casting`). Actions: `{type:
'ember-device', id}` runs `moveTo` (no-op on the lit row, toast "Moved to
Windows"), a local output row or the "This phone" / "This computer" row
while controlling runs `moveHere` then `chooseOutput`. `playingOn` returns
the remote label while controlling (precedence: cast, remote, output);
`devicesLabel` follows; `devicesButtonVisible` is true when another fresh
device exists. Labels from `lib/versions/label.ts`.
Tests: extend `rows.test.ts` (section order, lit row, stale detail text,
local rows not current while controlling, "This phone" row only while
controlling, `playingOn` precedence), `controller.test.ts` (a device row
calls `moveTo`; a local output while controlling calls `moveHere` before
`select`; a cast row while controlling brings the music here first),
`DevicesButton.test.tsx` renders the new rows and fires the actions.
Tier: sonnet-worker.

**W8. Sandbox e2e** (`tests/remote-control-ui.test.mjs`,
`package.json` `test:remote-ui`). Two Playwright contexts, one account,
two device ids (clear `ember.device.id` per context). A plays an uploaded
song; within 3 s B shows the same title with "Playing on Browser" and the
seek bar moving; B presses pause and A's audio element pauses within 2 s;
B seeks to 20 s and A's `currentTime` follows; B presses next and A's
title changes; B taps a different song in its library and A plays that
song within 3 s while B stays in remote mode; B opens the picker and picks
its own "This computer" row, B's audio element plays that song at A's
position within 3 s and A is paused; B picks A's row and the music is back
on A at B's position within 3 s; A is closed and B shows "Last seen" then
leaves remote mode within 40 s; a second account's context never lists A.
Record timings in the output for the latency target. Also
`lib/changelog.ts` entry (user-visible merge), no prank wording.
Tier: sonnet-worker.

**W9. Queue commands on the server and the link** (`lib/remote/parse.ts`,
`useRemoteLink.ts`, `remoteBackend.ts` pieces for `setQueue`, `playAt`,
`addToQueue`). Listed on its own so the first merge can go without it if
it slips; its pieces are already named in W1, W4 and W5 above. If it
slips: tapping a song on the controller plays locally and Windows pauses.
Tier: sonnet-worker.

### Android native (apps/mobile/android)

The webview is frozen when the screen is off (`androidBackend.ts` line
272), so both the player's heartbeat and the controller's lock-screen
session must live in the service.

**A1. `RemoteLink.kt`** in `app/ember/music`: a class with injected
`ServerApi`, `Delay` (as `PlaybackLog.kt`), a clock and a player facade.
Builds light and full snapshots from the Media3 player and the queue the
service owns (`queueJs` already shapes items), beats on the W3 cadence,
applies `play/pause/next/prev/seek/setVolume/setLoop/setShuffle/playAt/
addToQueue/setQueue` directly to the player and the service's queue
(`setQueue` goes through the same path the plugin's `setQueue` uses),
acks, honours `yield` and `want: 'full'`, stops when the queue is empty
or the cookie is gone (`"signed out"` check as the service does at line
430). Started by the service when playback starts, stopped in
`onDestroy`.
Tests: `RemoteLinkTest.kt` (JUnit, fakes like `PlaybackLogTest`): cadence
by watchers, light vs full after a track change, each command maps to one
player call, `setQueue` replaces the queue and starts at `startSec`,
duplicate ids ignored, expired commands skipped, backoff on IOException,
stop on sign-out, nothing sent with an empty queue.
Tier: opus-worker.

**A2. Plugin handshake for the player link** (`EmberPlayerPlugin.kt`,
`lib/playback/androidBackend.ts`). New plugin method
`setRemoteLink({ deviceId, label })` and `remoteLink: true` in
`getState()`. The web backend calls it once at start; when the flag is
present `useRemoteLink` stays off on the web side so there is one source
of beats per device. Older APKs keep the web heartbeat (works while the
app is on screen).
Tests: `QueueItemsArgTest`-style test for the method's argument parsing;
`androidBackend.remote.test.ts` (plugin with the method: web link
disabled, device id forwarded; plugin without it: web link on).
Tier: sonnet-worker.

**A3. `RemotePlayer.kt` and the controller session** (new
`RemotePlayer : SimpleBasePlayer`, `RemoteWatch.kt`, changes in
`EmberPlaybackService.kt`). `RemotePlayer` maps a snapshot to Media3 state
(media item with title, artist, artwork URI, duration; position with the
server clock offset; `playWhenReady`; available commands play, pause,
seek, next, previous) and turns `handleSetPlayWhenReady`, `handleSeek`,
`handleSeekToNext/Previous` into `POST /api/remote/command` through
`ServerApi`, with the optimistic state and a 4 s revert like the web.
`RemoteWatch` polls `/api/remote/state` on the controller cadence (3 s,
10 s with the screen off via `PowerManager.isInteractive`, at once on
`ACTION_SCREEN_ON`) and feeds `RemotePlayer`; it also hands each state to
the plugin for the webview (A4). The service swaps
`mediaSession.setPlayer(remotePlayer)` on `controlRemote(deviceId)` and
back to ExoPlayer on `stopControlRemote()` or when the remote goes stale
(35 s), stopping ExoPlayer first and keeping the foreground service alive
while the remote plays (the existing guard handles the pause case). The
notification's artwork loads through the existing `ArtworkSources`
bitmap loader.
Tests: `RemotePlayerTest.kt` (snapshot to state table: playing, paused,
stale, no track; each handle posts one command with the right body; a
revert after a disagreeing snapshot; position follows the offset),
`RemoteWatchTest.kt` (cadence by screen state, immediate poll on screen
on, stops on stale and on stop, backoff on IOException), a
`ServiceCarTest`-style test that `controlRemote` swaps the session's
player and `stopControlRemote` swaps it back with ExoPlayer stopped.
Tier: opus-worker.

**A4. Plugin surface for the controller** (`EmberPlayerPlugin.kt`,
`androidBackend.ts`, `useRemoteDevices.ts`). Plugin methods
`controlRemote({ deviceId })`, `stopControlRemote()`, a `remoteState`
event carrying the `/state` answer, and `remoteController: true` in
`getState()`. On such a build the web `useRemoteDevices` stops polling
itself and reads `remoteState` events instead (one poller per phone), and
`startControlling` / `stopControlling` in the provider call the plugin.
Older builds: web polling, no lock screen.
Tests: Kotlin argument parsing test; `androidBackend.controller.test.ts`
(events reach the store, the web poll is off, `startControlling` calls
the plugin, an older plugin leaves the web poll on).
Tier: sonnet-worker.

### Desktop (apps/desktop, Tauri)

A minimized WebView2 window throttles page timers hard after 5 minutes,
and the Rust engine, not the page, plays the audio, so the page does not
get the "playing audio" exemption. Beats must come from Rust.

**T1. `remote.rs`**: a tokio task started by `remote_link_start { base_url,
cookie, device_id, label }` (cookie as `sessionCookie()` already hands the
engine), stopped by `remote_link_stop`. The page pushes the full snapshot
JSON with `remote_snapshot_set` on every queue or track change; Rust fills
position, duration and paused from the engine for every beat, posts on
the W3 cadence, and emits each received command as a `remote-command`
event. `tauriBackend.ts` listens and routes play, pause, next, prev and
seek into the `RemoteCommands` it already holds for the media keys
(`cmds`), and volume, loop, shuffle, `playAt`, `addToQueue` and
`setQueue` into the provider through new backend events (the `setQueue`
body is handed to the page unparsed by Rust and parsed there). While the
Rust link runs, the web `useRemoteLink` is off (capability answered by
`remote_link_start`).
Tests: Rust unit tests in `remote.rs` against a local test server (the
`audio/one_request.rs` pattern): light vs full, cadence by watchers,
commands emitted once, large `setQueue` passed through intact, 429
backoff, stop on `remote_link_stop`; `tauriBackend.remote.test.ts` (an
emitted `pause` reaches `cmds.pause`, an emitted `setQueue` reaches the
new event, the web link is disabled when Rust answers capable).
Tier: opus-worker.

### Later slices (same design, not in the first merges)

**L1. Full-queue relay.** A `want: 'queue'` beat that sends every queue id
plus a tracks-by-ids lookup on the receiving device, so a move carries
the whole queue, shuffle backup included, instead of 300 (or 20) tracks.

**L2. Transport upgrades.** Long poll on `/beat`; PocketBase realtime
behind a flag where the host serves `/pb` uncompressed.

**L3. iOS.** The Capacitor iOS shell gets the A2 and A4 equivalents once
the iOS app exists beyond a webview.

## 5. Rollout order

1. **Slice 1a: W1, W2, W3, W4, W5, W6, W9, W8 (control part).** Covers the
   owner's exact case: the Windows app is open and playing, the phone
   opens and controls it, a tap on a song on the phone plays it on
   Windows. "Playing on Windows" shows, but the picker rows wait for 1b.
   Known gaps until later slices: a desktop window minimized for more than
   5 minutes may beat once a minute until T1; an Android player with the
   screen off does not take commands until A1; no lock screen on the
   controlling phone until A3.
2. **Slice 1b: W7, W8 (move part).** Other devices in the output picker;
   picking one moves the music; picking a local output brings it back.
   1a and 1b may merge together if both are green at once.
3. **Slice 2: A1, A2, A3, A4.** Phone as the player with the screen off,
   and the lock-screen controller. Ship in the next Android test APK
   ("Ember Test", LAN) before the real APK.
4. **Slice 3: T1.** Desktop as the player while minimized.
5. **Slice 4: L1** (whole-queue moves), then L2 and L3 if wanted.

Review and merge per slice. Preview commit names and the changelog text
before any push. Each merge gets one `lib/changelog.ts` entry.

## 6. Risks

- The 16 `'android'` checks in PlayerProvider are the main regression
  surface. W6 is one worker, one review, and `PlayerProvider.android.test.tsx`
  plus `PlayerProvider.cast.test.tsx` must stay green.
- Persisted store writes while controlling would overwrite the phone's own
  saved queue. The backup and restore in W6 is tested for exactly this;
  a move (`adopt`) is the one case where dropping it is intended.
- `setQueue` bodies: 300 full tracks is about 120 KB. The cap, the 413 and
  the 20/min limit hold it; L1 removes the need to send tracks at all.
- Swapping the Media3 session's player (A3) touches the Android Auto
  browser and the foreground guard. The `ServiceCarTest`-style test and a
  manual car check by the owner are both needed before the real APK.
- Battery on the controlling phone with the screen off: one small request
  every 10 s while the remote plays. Stops when the remote pauses for
  longer than the guard or goes stale.
- Clock skew between devices: all timing uses the server's `now`.
- Two tabs on one device: `claimSingleton('remote-link')` keeps one beat
  source per page set, and a second tab acts as a controller of nothing
  (same device id is never listed to itself).
- A host restart empties the store. Players send a full snapshot on the
  next `want: 'full'` within one beat; controllers see "Last seen" for
  up to 10 s. An unsent `setQueue` is lost; the picker's toast is shown
  only after the 202, and the move is retried by the user.

## 7. Decisions taken (owner, 2026-11-08)

1. **One device at a time: yes.** Starting playback on a second device
   pauses the first. Fixed rule, no setting.
2. **Tapping a song on the phone while it controls Windows plays it on
   Windows.** Pulled into slice 1a (W9). Interim if W9 slips: the phone
   takes over and plays locally, Windows pauses.
3. **Lock screen while controlling: yes.** The phone shows a media
   notification and lock-screen controls (play, pause, next, previous,
   seek, title, art) that drive the remote device. Tasks A3 and A4, slice
   2.
4. **Devices in the existing output picker; picking one moves the music.**
   No separate Devices picker. Platform words as names. Tasks W7 and the
   move paths in W3 and W6, slice 1b.

No open owner decisions remain for the first slices.
