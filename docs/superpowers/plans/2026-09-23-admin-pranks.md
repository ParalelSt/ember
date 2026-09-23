# Admin Pranks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Plan only: no product code was written while drafting this.

**Goal:** From the admin pages, an admin picks a friend, sees in plain words what they are playing right now, and can (a) swap the audio under their current song for another file while title, artist, artwork and the seek bar stay as they were, then hand the real song back where it would have been; (b) play a sound effect from an admin-uploaded library over (or ducking) their music; (c) schedule either to repeat every N seconds until a stop time. All of it lands on the target within a second or two on all three playback engines, every prank is logged, the target can opt out, and the owner can switch the whole thing off.

**Architecture:** A PocketBase collection `pranks` is both the command queue and the audit log. Admins write rows through a Next route (server-side admin client, so the collection's create rule is `null`); the target's running app holds one PocketBase realtime subscription filtered to its own pending rows, with a catch-up fetch on connect and a slow poll while the SSE link is down. A `PrankReceiver` inside the player layer turns a row into engine calls: for web and desktop the existing `load(url, opts)` already plays any URL without touching metadata, so the swap needs no native change there; sounds play through a second `<audio>` element in JS; Android, whose native Media3 player owns the queue, gets four new plugin methods (swap, restore, overlay play, overlay stop); the desktop Rust engine gets an optional overlay sink pair only if the webview overlay fails the device check. Repeating pranks are rows in `prank_schedules`, materialised into `pranks` rows by a server tick in `instrumentation.ts` (same pattern as the digest job). A presence heartbeat from each playing client gives the admin page its "playing now" line in words, never ids.

**Tech stack:** Next.js 16.2.6 (`apps/web`, read `node_modules/next/dist/docs/01-app/**` at the repo root before any Next-specific code: `apps/web/node_modules/next` does not exist in this worktree), PocketBase 0.22 (JS SDK 0.27; realtime subscriptions accept `filter` since PB v0.20.0 per `pocketbase/CHANGELOG.md`), vitest + happy-dom, Capacitor Android (Kotlin, Media3 ExoPlayer, Robolectric 4.14 JVM tests), Tauri 2 (Rust, rodio 0.21 mixer + Sink).

**Branch:** `admin-pranks` cut from `test-all` in `/Users/aronmatoic/Documents/Main Projects/spotify-clone-wt/test-all` (or a fresh worktree of it; whoever implements passes the absolute path to every worker). Commit after each task. Never commit to `main`, never push or merge unless the owner says so. `docs/superpowers/` is gitignored; this plan stays uncommitted.

---

## Global constraints (repeat these to every worker)

- Worktree: `/Users/aronmatoic/Documents/Main Projects/spotify-clone-wt/test-all` (absolute paths everywhere; cwd resets between shell calls).
- NEVER run `npm install`, `npm ci` or `npm version` in any `spotify-clone-wt` worktree: `node_modules` are symlinks into the main checkout and npm will wreck the main install. No new JS dependencies. Everything this plan needs is installed: `pocketbase` (realtime), `music-metadata` (duration of uploads), `sonner`, `@tanstack/react-query`, `zustand`. Cargo and Gradle dependencies are fine, but none are needed.
- Sandbox only: app on 3050, PocketBase on 8088, started with `/Users/aronmatoic/Documents/Main Projects/spotify-clone-wt/_sandbox/start-app.sh`; rebuild with `cd apps/web && POCKETBASE_URL=http://127.0.0.1:8088 npx next build --webpack`. `SINK=1 ./start-app.sh` for any test that could post to Discord. Never touch :3000, :8090, any `pocketbase` binary or any `pb_data` outside the sandbox. Another worker is editing code in this worktree while this plan is drafted: the implementer starts from a fresh branch and rebases, never resets.
- New PocketBase collections and user fields are created by `onAfterBootstrap` hooks in `pocketbase/pb_hooks/ensure_*.pb.js` (copy the shape of `ensure_sessions.pb.js` and `ensure_privacy_fields.pb.js`), never by editing `pb_data`.
- No em dashes anywhere: code, comments, copy, docs, commit messages.
- Tests for every task, run before committing: `cd apps/web && npx vitest run <files>` (the named files, not the whole suite unless a task says so), `cd apps/mobile/android && ./gradlew testDebugUnitTest --tests 'app.ember.music.Prank*'`, `cd apps/desktop/src-tauri && cargo test --lib audio`, plus the sandbox browser test `node tests/pranks-ui.test.mjs` (two browser contexts: admin and target).
- Style: spacing tokens only (`gap-row`, `mb-stack`, `py-section`, `size-hit` and the rest from `docs/design-system.md` section 2), `EmptyState` for empty and loading, `SectionHeader` / `PageTitle` for headings; `lib/lintRules.test.ts` must stay green. `/dizajn` candidates live in `components/library/options/pranks/`, render mock data only, import no hooks, stores, react-query or `PlayerProvider`, and nothing outside `app/(app)/dizajn/**` imports them (ESLint enforces this).
- Pranks never write to `likes`, `plays`, `playlists`, `playlist_tracks`, the `tracks` pool or the player store's `queue`/`index`/`context`. A test in Task 4 and Task 5 asserts this.

---

## 1. Delivery channel

**Choice: PocketBase realtime on the new `pranks` collection, filtered to the signed-in target, plus a catch-up fetch on every (re)connect, plus a 3 s poll of `/api/pranks/inbox` only while the realtime link is down.**

How it works, end to end:

1. Admin clicks Send. `POST /api/admin/pranks` (Next, `requireAdmin`) validates, applies the guard rails (section 6), and creates a `pranks` row with `status = "pending"` and `expires_at = now + 45 s` using `createAdminClient()`. The collection's `createRule` is `null`, so this route is the only writer.
2. The target's app runs `usePrankInbox()` (mounted once inside `PlayerProvider`'s tree, next to `useDiscordPresence`). On sign-in it calls `createClient().collection('pranks').subscribe('*', onEvent, { filter: 'target = "<userId>" && status = "pending"' })`. PocketBase evaluates the collection `viewRule` per subscriber for every event, so a client only ever receives rows where `target = @request.auth.id`. The filter is a second fence, not the first.
3. The browser reaches PocketBase through the same-origin `/pb` rewrite (`apps/web/next.config.ts`). SSE through `next start`'s external rewrite proxy is the one unverified link: Task 1 begins with a spike (a sandbox script that subscribes through `http://127.0.0.1:3050/pb/api/realtime`, creates a row with the admin client, and asserts the event arrives in under 2 s). If it does not stream, the fallback is already in the design: the poll runs whenever `pb.realtime.isConnected` is false, and Task 1's note records which path production uses. Shells load the host's web app, so Android and desktop use exactly the same code path; the Tauri capability already whitelists the remote origin for IPC, and SSE is plain HTTP to the same origin.
4. On the `create` event (or a catch-up/poll hit) the receiver checks the local state (opt-out mirror, is music playing, engine), acts, and acknowledges: `PATCH /api/pranks/[id]` with `{ status: 'delivered' | 'skipped', reason?, engine, appVersion }`. When the prank finishes it sends `{ status: 'done', playedSec }`. The PATCH route only accepts the target's own rows and only the forward transitions `pending -> delivered|skipped -> done`.
5. Offline or old build: nothing acknowledges the row. The scheduler tick (Task 7) and the admin log route both treat `status = "pending" && expires_at < now` as `expired`; the admin log shows "not delivered: offline, paused, or app too old". An app build without the receiver simply never subscribes; the row expires 45 s later. No retries: a prank that arrives late is not a prank.
6. Realtime disconnects (phone sleeps, tunnel hiccup): the SDK reconnects on its own; `pb.realtime.subscribe` re-sends the topic. On reconnect the receiver fetches `/api/pranks/inbox` (pending, not expired) so a row created during the gap is still honoured if it is inside its 45 s window.

Why not the sessions-style poll (`session_commands` + consume route)? It works, but a 2 s poll from every open client, all day, is the cost of a feature used a few times a week. Realtime costs one idle SSE connection per client, which PocketBase is built for.

Authorisation summary for `pranks`: `listRule` and `viewRule` `target = @request.auth.id || @request.auth.is_admin = true`; `createRule`, `updateRule`, `deleteRule` all `null` (Next routes write with the admin client). The realtime topic never exposes another user's rows because the view rule is evaluated per event.

---

## 2. Data model (`pocketbase/pb_hooks/ensure_pranks.pb.js`)

One boot hook creates everything below if missing, in this order (relations need the earlier collections).

**`prank_sounds`** (the admin library; sounds and prank songs)

| field | type | notes |
| --- | --- | --- |
| `kind` | text | `sound` (short effect) or `song` (swap source) |
| `name` | text, max 120 | what the admin picks by |
| `filename` | text | relative to `MUSIC_DIR/pranks`, random name (`newFilename`) |
| `mime` | text | from `MIME_BY_EXT` |
| `duration_sec` | number | measured with `music-metadata` at upload |
| `size_bytes` | number | |
| `uploaded_by` | relation users, no cascade | |

Rules: `listRule` and `viewRule` `@request.auth.is_admin = true`; create/update/delete `null`. Index on `kind`.

**`pranks`** (command queue and audit log)

| field | type | notes |
| --- | --- | --- |
| `target` | relation users, cascade delete | who receives it |
| `issued_by` | relation users, no cascade | which admin |
| `schedule` | relation prank_schedules, optional | set when a tick created it |
| `kind` | text | `swap`, `sound`, `ping` (`ping` is a no-op used by tests and the "is this person reachable" button) |
| `sound` | relation prank_sounds, optional | for `sound` and library-backed `swap` |
| `params` | json | `{ durationSec, volume, mode: 'over'|'duck', startFrom: 'start'|'same', streamUrl?, catalogTrackId? }` |
| `status` | text | `pending`, `delivered`, `skipped`, `done`, `expired`, `cancelled` |
| `reason` | text | `opted-out`, `not-playing`, `paused`, `busy`, `engine-unsupported`, `error:<short>` |
| `engine` | text | `web`, `capacitor`, `android`, `tauri-native`, reported by the target |
| `app_version` | text | `NEXT_PUBLIC_APP_VERSION` reported by the target |
| `expires_at` | date | created + 45 s |
| `delivered_at`, `done_at` | date | |
| `played_sec` | number | how long it actually ran |

Rules as in section 1. Indexes: `(target, status)`, `(created)`.

**`prank_schedules`** (repeating pranks)

| field | type | notes |
| --- | --- | --- |
| `target`, `issued_by`, `kind`, `sound`, `params` | as above | |
| `interval_sec` | number | min 60 |
| `ends_at` | date | max created + 2 h |
| `next_fire_at` | date | |
| `active` | bool | |
| `fired` | number | count |

Rules: list/view `@request.auth.is_admin = true`; writes `null`.

**`users` gets two fields** (added by the same hook, `ensure_privacy_fields` style):

- `prank_opt_out` (bool). Default false means "admins may prank me". See section 6 for the recommendation and the owner question.
- `prank_reveal` (bool, default false meaning "reveal after each prank"; stored inverted so the default needs no migration). Only used if the owner picks the reveal option in section 6.

**Global switch:** a single record in a new `app_settings` collection (`key` text unique, `value` json), created by the hook with `key = "pranks"`, `value = { enabled: true }`. Rules: view `@request.auth.is_admin = true`, writes `null`. The Next routes read it once per request (cheap; five users). An env `PRANKS_ENABLED=0` also forces off, for sandboxes.

**Presence** (what the admin page shows as "playing now"): in-memory `Map<userId, Presence>` in `apps/web/lib/pranks/presence.ts`, fed by `POST /api/pranks/presence` every 20 s from each client whose music is playing (`{ track: Track, position, isPlaying, engine, appVersion }`), stale after 60 s. No collection: it refills within 20 s of a restart and needs no cleanup. Clients that opted out send nothing.

---

## 3. The three prank kinds, per engine

Shared contract (`apps/web/lib/pranks/types.ts`):

```ts
export type PrankKind = 'swap' | 'sound' | 'ping';
export interface PrankParams {
  durationSec: number;        // swap: 5..300; sound: ignored (file length), capped 30
  volume: number;             // 0.1..1, relative to the target's own volume
  mode: 'over' | 'duck';      // sound only; duck = music at 30% while it plays
  startFrom: 'start' | 'same';// swap only; where the prank file starts
}
export interface PrankRow {
  id: string; kind: PrankKind; params: PrankParams;
  /** Absolute-or-relative URL the receiver loads; always /api/pranks/media/<soundId>
   *  or a catalogue stream URL. Set by the server, never by the client. */
  streamUrl: string;
  expiresAt: string;
}
/** What the receiver hands the player layer. Pure state machine, unit tested. */
export type PrankAction =
  | { type: 'skip'; reason: string }
  | { type: 'sound'; url: string; volume: number; duck: boolean }
  | { type: 'swap'; url: string; startAt: number; durationSec: number }
  | { type: 'ack-only' };
```

The decision `decidePrank(row, ctx)` in `lib/pranks/decide.ts` is a pure function of `{ optOut, isPlaying, hasTrack, engine, busy, pluginHasSwap, pluginHasOverlay, now }` and is the thing the unit tests hammer.

### 3a. Swap the song

Target keeps title, artist, artwork, the queue, the seek bar's position and length, Discord presence and history exactly as they were; only the audio differs, for `min(durationSec, remaining real song time)`; then the real song resumes at `swapStartPos + elapsed`.

**Provider swap mode** (`apps/web/components/player/PlayerProvider.tsx` plus a new pure helper `lib/playback/swapClock.ts`): a `swapRef` holds `{ trackId, offset, prankStartedAtMs, durationSec, realDuration, timer }`. While set:

- `onTime(sec)` writes `offset + sec` to the store when `startFrom = 'start'`, or `sec` unchanged when `startFrom = 'same'` (the file was loaded with `startAt = offset`). `swapClock.displayPosition(mode, offset, sec)` is the tested function.
- `onDuration` is ignored (the store keeps the real song's length).
- `seek(sec)` from the UI maps to `max(0, sec - offset)` on the prank file in `'start'` mode.
- `onEnded` is intercepted BEFORE the existing early-ended check (`ENDED_SLACK_SEC`, `PlayerProvider.tsx:64`), otherwise a short prank file would be treated as a failed stream: it calls `endSwap('file-ended')`.
- A timer fires `endSwap('timer')` after `durationSec`.
- `endSwap(reason)`: expected = `offset + backend.getCurrentTime()` in `'start'` mode (the backend's own clock, so a pause by the target pauses the joke too); if `expected >= realDuration - 1` then `nextRef.current()` (the song "would have ended"); else `positions.requestStartAt(expected); loadAndPlay(track, true)`. `loadAndPlay` with `autoplay = true` always loads, so the `loadedTrackRef` guard does not block the restore. The ack `done` carries `played_sec`.
- A track change during a swap (skip, tap in a list, native transition) clears `swapRef` without a restore; the clearing lives at the top of `loadAndPlay` and in `onQueueIndex`.
- `recordPlay` fires from the `current` change effect (`PlayerProvider.tsx:474`), and the swap never changes `current`, so history is untouched. `useDiscordPresence` reads the store's track, so Discord keeps showing the real song.

**Web (`lib/playback/webBackend.ts`)**: no change. `load(prankUrl, { autoplay: true, startAt })` sets `a.src` and leaves `navigator.mediaSession.metadata` alone (metadata only changes in `setMetadata`, which the swap never calls). Restore is another `load`.

**Desktop (`lib/playback/tauriBackend.ts`, `apps/desktop/src-tauri/src/audio.rs`)**: no new command. `audio_load(url, autoplay, start_at, cookie)` replaces the sink and never touches Now Playing metadata (`audio_set_metadata` is separate). The `pb_auth` cookie is already forwarded, so the authenticated media route works. `audio:ended` from the prank file arrives as `onEnded` and hits the swap intercept. One caveat to test on device: `audio_load` logs the URL at INFO (`load #n ... url=`), so the desktop log reveals the prank to a target who reads logs. Acceptable; noted in the reveal question.

**Android (`lib/playback/androidBackend.ts`, `EmberPlayerPlugin.kt`, `EmberPlaybackService.kt`)**: the native player owns the queue, so the swap must happen there. New plugin methods:

```kotlin
@PluginMethod fun swapSource(call: PluginCall)   // { url: String, startAt: Double, durationSec: Double }
@PluginMethod fun restoreSource(call: PluginCall) // {}
```

`swapSource`: take the current item `orig` at index `i`; build `swapped = orig.buildUpon().setUri(url).setMediaMetadata(orig.mediaMetadata.buildUpon().setExtras(extras + "ember.swap" = true).build()).build()` (same `mediaId`, same title/artist/artwork, so the notification and Android Auto screen do not change); set `queueFromJs = now` (so `onTimelineChanged` does not echo a "queue" event); `c.replaceMediaItem(i, swapped)`; `c.seekTo(i, (startAt * 1000).toLong())`; remember `SwapState(i, orig, startedAtMs, startAtMs, durationMs)`; arm `main.postDelayed(::restoreSource, durationMs)` natively, so a dead WebView never leaves the target stuck on the prank file. `restoreSource`: expected = `startAtMs + (c.currentPosition when still on the swapped item)`, capped at `orig` duration; `replaceMediaItem(i, orig)`; if expected >= duration: `seekToNextMediaItem()` else `seekTo(i, expected)`; clear state; emit `swap` event `{ phase: 'ended', expectedSec, reason }`. Listener rules in the plugin: on `onMediaItemTransition` with reason `AUTO` leaving the swapped index (prank file shorter than the window) call `restoreSource` with the position clock; with reason `SEEK` (user skipped) restore `orig` at index `i` silently (no seek) so the prank URI never lingers in the queue. Service: `onMediaItemTransition` must skip `api.recordPlay` when the new item carries the `ember.swap` extra or when its `mediaId` equals the last recorded one, so the swap and the restore add no history rows (both keep the mediaId). `maybeExtendQueue` is unaffected (same index).

JS side: `androidBackend.ts` gains optional `swapSource?(url, startAt, durationSec)` and `restoreSource?()` on the `AudioBackend` type (queue-owning backends only, like `setQueue`); the plugin's `swap` event maps to `events.onSwapEnded?.(expectedSec, reason)`. The provider uses the same `swapRef` mapping for the seek bar (native reports the prank file's position). Known tell: the lock-screen bar shows the prank file's own length while swapped. Old APKs (media-session plugin only, `capacitorBackend`) run the web path and work without an update.

### 3b. Sound effect over or under the music

**JS overlay (`lib/pranks/overlayPlayer.ts`)**: a second `<audio>` element, `play(url, { volume })` returning a promise that resolves on `ended` or `error`, `stop()`. The provider exposes `duck: number` (1 = none) folded into the existing volume effect (`PlayerProvider.tsx:350`): `b.setVolume((muted ? 0 : volume) * duck, { gain })`. `mode: 'duck'` sets `duck = 0.3` for the sound's length, then 1. Overlay volume = `params.volume * targetVolume`, never louder than what the target set. Ducking through `setVolume` works on all three engines with no native change (`audio_set_volume`, ExoPlayer `volume`, `a.volume`).

- **Web**: overlay element. Autoplay policy: the page already has sticky user activation when music is playing (they pressed play), so `play()` is allowed. `decidePrank` skips with `not-playing` otherwise.
- **Desktop**: overlay element in the Tauri webview, same reasoning; the device check in Task 3 confirms it on macOS (WKWebView) and Windows (WebView2). If either blocks it, Task 6 adds the Rust overlay: `audio_overlay_play(url: String, cookie: Option<String>, amplitude: f32) -> Result<(), String>` (a second `Sink::connect_new(mixer)` fed by `open_source`, stored in a new `overlay: Arc<Mutex<Option<Sink>>>` on `AudioEngine`, its own tiny poll task emitting `audio:overlay-ended`, never touching `generation` or the main sink) and `audio_overlay_stop()`, both added to `permissions/app-commands.toml`. The Tauri backend picks native when the command resolves and the element when it rejects (old shell).
- **Android**: WebView audio is throttled in the background, and the point is the phone in a pocket, so the overlay is native. New plugin methods:

```kotlin
@PluginMethod fun playOverlay(call: PluginCall) // { url: String, volume: Double, duck: Double }
@PluginMethod fun stopOverlay(call: PluginCall)
```

Implemented in `EmberPlaybackService` (reached through a `SessionCommand("ember.overlay")` custom command so the plugin keeps talking only to the `MediaController`, the way shuffle and repeat already do): a second `ExoPlayer` built with the same `OkHttpDataSource.Factory(api.http)` (cookie carried) and `setAudioAttributes(USAGE_MEDIA, handleAudioFocus = false)` so it never pauses the music; on start set `player.volume *= duck`, on `STATE_ENDED` or error restore the volume and release the item; emit `overlay` `{ phase: 'ended' }`. Old APKs fall back to the JS overlay (foreground only) and the ack says `engine = capacitor`.

### 3c. Scheduled and repeating pranks

Rows in `prank_schedules`. A tick in `instrumentation.ts` every 5 s (guarded by `PRANKS_ENABLED !== '0'` and `IMPORT_RUNNER_DISABLED`-style opt-out `PRANK_TICK_DISABLED=1` for tests) runs `lib/pranks/scheduler.ts#runTick(now, store)`: for each `active && next_fire_at <= now` schedule, if `ends_at < now` deactivate; else if the target opted out or the global switch is off deactivate with `reason`; else create one `pranks` row (same validation as the manual route, same caps), bump `fired`, set `next_fire_at += interval_sec`. It also expires stale pending rows (`expires_at < now`). `runTick` is pure over an injected store interface, so vitest covers it without PocketBase. Stop: `DELETE /api/admin/pranks/schedules/[id]` sets `active = false` and cancels that schedule's pending rows. The admin log lists active schedules at the top with a Stop button and a "Stop everything" button that deactivates all schedules and cancels every pending row.

---

## 4. "Decode the IDs": what the admin sees

The admin never sees `youtube:abc123` or `upload:xyz`. Sources, in order:

1. **Presence** (section 2): the target's client reports the full `Track` object it is playing. The admin page shows avatar, name, a green or grey dot, "Playing `Title` by `Artist`, 1:23 of 3:45, since 4 min ago, on Android", or "Paused", or "Not listening (last seen 12 min ago)". `GET /api/admin/pranks/people` merges `users` (existing admin list) with presence and, for users with no presence, the newest `plays` row within 30 min (expand `track`, mapped with `mapTrackRow`, shown as "Was playing X, N min ago", the same query `app/api/listening/route.ts` runs but without the `share_listening` filter: pranking someone implies seeing what they play, and opted-out users show "Opted out of pranks" with no track).
2. **Replacement songs by name**: the composer's song picker lists `prank_sounds` where `kind = 'song'` by `name`, and (owner question 4) a second tab searches the catalogue with the existing `/api/search` (results are `Track`s with `streamUrl`, so a catalogue swap stores `params.streamUrl = track.streamUrl` and `params.catalogTitle`). Sounds are picked by name from `kind = 'sound'`.
3. **Log lines in words**: "Aron played `Duck quack` over Marko's `Song X` at 21:03, delivered on desktop, done after 2 s". Kinds, statuses and reasons are rendered through one copy table in `lib/pranks/copy.ts` (tested).

Nothing in the admin UI needs `external_id` or PocketBase ids except as React keys and request bodies.

---

## 5. Uploads: the prank library

- `POST /api/admin/pranks/sounds` (multipart `file`, `name`, `kind`), admin only, rate limit `prank-upload:<adminId>` 30 per hour. Reuses `lib/uploads.ts` helpers: `ALLOWED_TYPES`, `sniffAudio` (magic bytes, not the claimed type), `newFilename`, and a new `resolvePrankPath` mirroring `resolveUploadPath` against `PRANK_DIR = path.join(MUSIC_DIR, 'pranks')`. Duration via `music-metadata` (already used by the uploads cover extractor). Caps: `sound` 5 MB and 30 s (longer is rejected with "Sounds are 30 seconds at most; upload it as a song"), `song` 50 MB (same as member uploads). Formats: mp3, m4a, flac, ogg, opus, wav, webm. Recommendation to the owner: mp3 or m4a only in the UI hint, because the desktop rodio decoder is built with the mp4 and mp3 features and the Android ExoPlayer handles both; flac and ogg play on web but are the ones most likely to differ per engine.
- `GET /api/admin/pranks/sounds` (admin list), `PATCH .../[id]` (rename), `DELETE .../[id]` (record first, file second, like uploads; refuses while any active schedule references it).
- `GET /api/pranks/media/[id]` streams with Range support (copy `app/api/uploads/[id]/stream/route.ts#serveFile`). Access: admins always; anyone else only when a `pranks` row exists with `target = me && sound = id && created > now - 24 h`. One PB query; no signed URLs, no secrets. The desktop engine sends `pb_auth`, Android's OkHttp sends the WebView cookie, so all three engines pass this check.
- Never in normal surfaces: the files live in `MUSIC_DIR/pranks`, not `MUSIC_DIR/uploads`; there is no `tracks` row, no `upsertTrack`, no `Track.id`; `/api/uploads` and `/api/search` never read `prank_sounds`. A lint-style vitest (`lib/pranks/isolation.test.ts`) greps `app/api` and asserts the only files that read `prank_sounds` are under `app/api/admin/pranks/**` and `app/api/pranks/media/**`.
- Visible to admins only (collection rules plus `requireAdmin` on every list route). The target's client only ever sees one `streamUrl` string per prank.

---

## 6. Guard rails

| rail | where enforced | value |
| --- | --- | --- |
| audit log | every `pranks` row is the log; `serverLogger.info('pranks', ...)` on create, ack and expiry | admin-only page, last 200, filter by person |
| global off switch | `app_settings.pranks.enabled` checked by the create route, the media route and the tick; `PRANKS_ENABLED=0` env forces off | toggle on the admin page, off cancels pending rows and deactivates schedules |
| per-user opt-out | `users.prank_opt_out`; create route refuses (`409 opted-out`), tick skips, receiver double-checks the mirror in `usePrivacyStore` | Settings > Profile toggle "Let admins prank me" |
| frequency caps | `lib/pranks/limits.ts` (pure, tested) used by the route and the tick | per target: 1 swap active at a time, 15 s minimum gap between sounds, 20 pranks per hour; per admin: 60 per hour; schedule: `interval_sec >= 60`, `ends_at <= created + 2 h`, at most 3 active schedules per target |
| volume cap | `params.volume <= 1`, applied relative to the target's own volume; duck floor 0.3 | overlay can never be louder than their music |
| duration cap | swap 5 to 300 s; sound capped at 30 s by the upload rule | |
| auto-expiry | `expires_at` 45 s on rows; schedules die at `ends_at`; the receiver ignores rows past `expires_at` even if delivered late | |
| never touch data | swap changes only the audio source; no `setQueue`, no `playTrack`, no `recordPlay`, no `upsertTrack`; Android skips history on `ember.swap` items | asserted by tests in Tasks 4 and 5 |
| only while listening | `decidePrank` skips with `not-playing` when nothing is playing (sound) or when paused (swap) | owner question 3 |
| easy stop | admin: Stop on a schedule, "Stop everything", global switch; target: pressing pause or skipping ends a swap immediately (no restore needed for a skip) and stops the overlay | |
| reveal | see recommendation below | owner question 2 |

**Recommendation on the opt-out default:** pranks allowed by default (`prank_opt_out = false`), with the toggle plainly visible in Settings > Profile beside the two share switches, and a one-time toast on the first prank received: "That was a prank from an admin. You can turn these off in Settings." This is a friends-only server where the owner asked for the feature; opt-in would mean the owner asks every friend to flip a switch before the first laugh. The toast makes sure nobody is left wondering.

**Recommendation on revealing:** reveal after, not during. When a prank finishes, the target gets a quiet toast "You just got pranked by Aron" and Settings > Profile gains a "Pranks on you" list (last 20, from `GET /api/pranks/mine`, rows where `target = me`). The joke lands, then everyone knows. A "never reveal" option exists only as the owner's override (`prank_reveal` field, set by an admin) and is not recommended: a friend who cannot explain why their music sounded wrong will blame the app, and the bug reports land in the owner's Discord.

---

## 7. Admin UI and the /dizajn step

Placement: a fourth tab in `components/admin/AdminTabs.tsx` (`{ href: '/admin/pranks', label: 'Pranks' }`), page at `app/(app)/admin/pranks/page.tsx` under the existing admin layout (which already redirects non-admins). One page, four regions: **People** (who is listening to what, the pick), **Compose** (kind, sound or song by name, duration, volume, mode, start-from, repeat every / until), **Library** (upload, rename, preview, delete), **Log** (active schedules with Stop, "Stop everything", global switch, last 200 pranks). On phones the regions stack; on desktop People sits left, Compose right, Library and Log below.

Task 0 puts three candidates on `/dizajn` (mock data, pill picker persisted to localStorage, `components/library/options/pranks/`):

- **Control room**: a people list with live "playing now" rows on the left and a composer card that fills in as you pick a person; log as a table below.
- **Card per person**: a grid of person cards, each with its now-playing line and a compact Sound / Swap / Repeat action row; composing opens a sheet; log as a feed.
- **Two-step wizard**: pick a person (with what they play), then a full-width composer with the library inline, then confirm; log on its own sub-tab.

The owner answers with a name; Task 8 builds the winner and deletes the losers.

---

## 8. Testing approach

- **vitest** (`apps/web`): pure modules (`decide`, `swapClock`, `limits`, `scheduler.runTick`, `copy`, `presence` staleness), route handlers with the existing fake PocketBase pattern (`app/api/admin/users/route.test.ts` shows how), the receiver hook with a fake `pb.collection().subscribe` (`test-utils/`), the provider's swap mode with `test-utils/fakeBackend.ts`, `/dizajn` option render tests (`page.test.tsx` pattern from `options/trending`).
- **Robolectric** (`apps/mobile/android/app/src/test/java/app/ember/music/Prank*Test.kt`): the pure swap bookkeeping (`SwapState.expectedPositionMs`, restore on AUTO vs SEEK, cap at duration), `TrackItems.swapped(item, url)` keeping mediaId/metadata and adding the marker, the history guard, and `PrankOverlay` state transitions against a fake `Player` (Media3 `SimpleBasePlayer` or a stub interface the service already uses).
- **Rust** (`cargo test --lib audio`): only if Task 6 runs; the overlay's pure parts (a second sink does not clobber `generation`, `audio_overlay_stop` on an empty engine is a no-op, `amplitude` clamp).
- **Sandbox browser test** `tests/pranks-ui.test.mjs` (playwright-core, `CHROME_PATH`, `PB_URL=http://127.0.0.1:8088 APP_URL=http://127.0.0.1:3050`, sandbox started with `SINK=1`): creates an admin and a target user (`@ember.test`), two `browser.newContext()`s with injected `pb_auth` cookies; the target plays a fixture upload from `tests/fixtures`; the admin fires a `ping` (arrives within 2 s: asserts `status = delivered` and the `engine` field), a `sound` (the second `<audio>` element gets a `src`, main element volume drops to 30% and comes back), a `swap` (main element `src` changes to `/api/pranks/media/...`, MediaSession metadata unchanged, store position keeps counting, after `durationSec` the `src` returns to the real stream and `currentTime` is within 2 s of expected, no new `plays` row, no likes change), opt-out (create returns 409), global switch off (409), rate cap (429), expiry (a row created for an offline user reads `expired` after 45 s in the log route), and a schedule firing twice then stopping. Each is a `check(name, pass)` line like the other suites.
- **Owner device checks** (listed per task): Android APK on a phone with the screen off, Android Auto head unit or the DHU, desktop macOS and Windows builds against the sandbox host, each with all three kinds plus a skip during a swap and a pause during a sound.

---

## 9. Tasks

Tiers: **sonnet-worker** for a feature touching a few files with tests; **opus-worker** for anything crossing PocketBase + Next + player + native, or touching `PlayerProvider`. Every task ends with the named tests green, `npx tsc --noEmit -p apps/web`, `npm run lint -w apps/web`, and one commit.

### Task 0: /dizajn candidates for the Pranks tab (sonnet-worker)

- [ ] `components/library/options/pranks/{index.ts,mock.ts,ControlRoom.tsx,PersonCards.tsx,Wizard.tsx,PranksSection.tsx}`: three candidates from mock people, mock now-playing lines, mock library and mock log; `PRANK_OPTIONS: PickerOption[]` in `index.ts`.
- [ ] `app/(app)/dizajn/page.tsx`: replace "Nothing to pick right now" with the Pranks question; `app/(app)/dizajn/sve/**` gains the section when the pick is made (Task 8).
- [ ] Tests: `components/library/options/pranks/page.test.tsx` renders each candidate from mock data and asserts the picker switches; `lib/lintRules.test.ts` stays green (spacing tokens only).
- [ ] No hooks, stores, react-query or player imports; nothing outside `dizajn/**` imports the folder.

### Task 1: Delivery spine (opus-worker)

- [ ] `pocketbase/pb_hooks/ensure_pranks.pb.js`: `prank_sounds`, `pranks`, `prank_schedules`, `app_settings` (with the `pranks` record), and the two `users` fields, all idempotent.
- [ ] Spike first: `tests/pranks-realtime.spike.mjs` subscribes through `APP_URL/pb/api/realtime` with a user token, creates a row with the admin client, asserts the event under 2 s. Record the result in the task's commit message. If it does not stream through the rewrite, the poll fallback below becomes the primary path and the subscribe stays as an upgrade.
- [ ] `lib/pranks/{types.ts,decide.ts,limits.ts,copy.ts,presence.ts,settings.ts}` (pure; `settings.ts` reads the global switch with the admin client).
- [ ] Routes: `POST /api/admin/pranks` (create, validates, caps, opt-out, switch), `GET /api/admin/pranks` (log with lazy expiry), `PATCH /api/admin/pranks/settings` (switch), `GET /api/admin/pranks/people` (users + presence + last play), `GET /api/pranks/inbox`, `PATCH /api/pranks/[id]` (ack), `POST /api/pranks/presence`. `withRequestLog` on all, `requireAdmin`/`requireUser`, `rateLimitResponse`.
- [ ] `hooks/pranks/usePrankInbox.ts`: subscribe with filter, catch-up on connect, poll while disconnected, ack; only `ping` is handled in this task (it acks `delivered` and logs a breadcrumb). `hooks/pranks/usePresenceHeartbeat.ts`: 20 s while playing, skipped when opted out. Both mounted from `PlayerProvider` in a tiny `PrankReceiver` component that receives `backendRef` and the engine kind.
- [ ] `lib/api.ts`: `api.pranks.*` and `api.admin.pranks.*` client calls.
- [ ] A minimal `/admin/pranks` page (temporary, plain list of people with a Ping button and the log) so the owner can try the spine before Task 8; new tab in `AdminTabs`.
- [ ] Tests: vitest for `decide`, `limits`, `copy`, `presence`, the create/ack/inbox/people routes with a fake PB, and the hook with a fake subscribe. Sandbox: first version of `tests/pranks-ui.test.mjs` (ping delivered, opt-out 409, switch 409, cap 429, expiry).

### Task 2: Prank sound library (sonnet-worker)

- [ ] `lib/pranks/media.ts` (`PRANK_DIR`, `resolvePrankPath`, `measureDuration` via `music-metadata`, caps), routes `POST/GET /api/admin/pranks/sounds`, `PATCH/DELETE /api/admin/pranks/sounds/[id]`, `GET /api/pranks/media/[id]` (Range, the target-of-a-prank access check).
- [ ] Extend Task 1's create route to require a `soundId` for `sound` and library `swap`, and to set `streamUrl` server-side.
- [ ] Temporary Library region on the minimal admin page (upload, list, delete).
- [ ] Tests: vitest for the routes (sniff rejects a renamed png, 30 s cap on sounds, delete refuses with an active schedule, media route 403 for a non-target and 200 for the target, Range 206), `lib/pranks/isolation.test.ts`. Sandbox: upload a fixture sound as admin, target fetches it 200 only after a prank row exists.

### Task 3: Sound overlay in JS, ducking, opt-out setting (opus-worker: touches PlayerProvider's volume path)

- [ ] `lib/pranks/overlayPlayer.ts`; provider `duck` state folded into the volume effect; `PrankReceiver` handles `sound` on `web`, `capacitor` and `tauri-native` engines (the Android native path arrives in Task 5; until then Android acks `engine-unsupported`).
- [ ] Settings > Profile: "Let admins prank me" toggle in `components/settings/PrivacyToggles.tsx` (extend `usePrivacyStore` and `/api/privacy` with `prankOptOut`), and the first-prank toast.
- [ ] Tests: vitest for the overlay player (resolves on ended, stop mid-way, volume relative), provider volume effect with duck (fakeBackend), privacy store and route. Sandbox: the `sound` scenario in `tests/pranks-ui.test.mjs`.
- [ ] Owner device check: desktop macOS and Windows builds against the sandbox host, a sound while music plays from the Rust engine; if either OS blocks the webview `play()`, open Task 6.

### Task 4: Song swap on web and desktop (opus-worker)

- [ ] `lib/playback/swapClock.ts` (pure: displayPosition, seekTarget, expectedResume, shouldAdvance), provider swap mode (`swapRef`, onTime/onDuration/seek/onEnded intercepts, timer, `endSwap`, clear on track change), `PrankReceiver` handles `swap` for `web`, `capacitor` and `tauri-native`; `startFrom` both modes.
- [ ] Tests: vitest `swapClock`; provider tests with `fakeBackend` (metadata never set during swap, store `queue`/`index`/`context` unchanged, position mapping, restore at expected, advance when the real song would have ended, skip during swap clears without restore, early-ended check not triggered by a short prank file, `recordPlay` not called). Sandbox: the `swap` scenario (src changes, MediaSession metadata unchanged, position continuity, no new `plays` row, likes untouched).
- [ ] Owner device check: desktop macOS and Windows, a 20 s swap with `startFrom = 'start'` and one with `'same'`, then a skip mid-swap.

### Task 5: Android native swap and overlay (opus-worker)

- [ ] `EmberPlayerPlugin.kt`: `swapSource`, `restoreSource`, `playOverlay`, `stopOverlay`; `swap` and `overlay` events; transition listener rules (AUTO restore with clock, SEEK silent restore); `queueFromJs` set on replace.
- [ ] `TrackItems.kt`: `swapped(item, url)` and `isSwapped(item)`; `EmberPlaybackService.kt`: history guard on swapped items, `PrankOverlay` (second ExoPlayer, `handleAudioFocus = false`, duck on the main player, restore on end), custom session commands `ember.overlay.play` / `ember.overlay.stop` added to `onConnect` and `onCustomCommand`.
- [ ] `lib/playback/types.ts`: optional `swapSource`, `restoreSource`, `playOverlay`, `stopOverlay`, `onSwapEnded`, `onOverlayEnded`; `androidBackend.ts` wires them; `PrankReceiver` prefers the native path on `android` and falls back to JS overlay only on `capacitor`.
- [ ] Tests: Robolectric `PrankSwapStateTest`, `TrackItemsSwapTest`, `PrankOverlayTest`, `HistoryGuardTest`; vitest for `androidBackend` (methods forwarded, events mapped) and `decide` with `pluginHasSwap` false on an old APK (`engine-unsupported` ack). Gradle: `./gradlew testDebugUnitTest --tests 'app.ember.music.Prank*'` plus the existing `TrackItemsTest`.
- [ ] Owner device check: new APK, screen off, a sound (music ducks, comes back), a 30 s swap (notification unchanged, lock-screen bar shows the prank length: known tell), a skip mid-swap (queue item back to the real URI: play it again later and hear the real song), Android Auto DHU shows the real title throughout, history has no extra rows.

### Task 6: Desktop Rust overlay (opus-worker; only if Task 3's device check fails)

- [ ] `audio.rs`: `overlay: Arc<Mutex<Option<Sink>>>` on `AudioEngine`, `audio_overlay_play(url, cookie, amplitude)`, `audio_overlay_stop()`, a poll task emitting `audio:overlay-ended`, registered in `lib.rs` and allowed in `permissions/app-commands.toml`; `tauriBackend.ts` `playOverlay`/`stopOverlay` with element fallback when invoke rejects.
- [ ] Tests: `cargo test --lib audio` (new unit tests on the pure parts and on `new_degraded` no-ops), vitest for the backend fallback. Owner device check: macOS and Windows sound over music from the Rust engine, volume relative to the slider.

### Task 7: Schedules and the server tick (sonnet-worker)

- [ ] `lib/pranks/scheduler.ts#runTick(now, store)` (pure over a store interface), `lib/pranks/schedulerInstance.ts` (5 s `setInterval`, `unref`, guarded by `PRANK_TICK_DISABLED` and the global switch) wired from `instrumentation.ts`; routes `POST /api/admin/pranks/schedules`, `GET`, `DELETE .../[id]`, `POST /api/admin/pranks/stop-all`.
- [ ] Tests: vitest `runTick` table (fires, respects interval, ends at `ends_at`, deactivates on opt-out or switch, caps, expires stale rows, never double-fires within one tick), route tests. Sandbox: schedule every 60 s for 3 min with a 20 s test override env `PRANK_TICK_INTERVAL_MS`, assert two rows then Stop.

### Task 8: The real admin page (sonnet-worker, after the owner's /dizajn pick)

- [ ] Build the chosen candidate as `app/(app)/admin/pranks/page.tsx` plus `components/admin/pranks/*` (People with presence lines, Compose with library and catalogue pickers, Library, Log with schedules, Stop everything and the global switch); delete the losing options; move the section to `/dizajn/sve`.
- [ ] Tests: vitest page tests with mocked `useAdmin` hooks (a person's line reads "Playing X by Y, 1:23 of 3:45, on Android", never an id; Send disabled until a target and a sound are chosen; Stop everything calls the route). Sandbox: `tests/pranks-ui.test.mjs` gains an admin-context run through the real page (pick, send, log line appears).

### Task 9: Reveal, "Pranks on you", changelog (sonnet-worker)

- [ ] `GET /api/pranks/mine`, Settings > Profile "Pranks on you" list, the after-prank toast honouring `prank_reveal`; changelog entry (`docs/changelog-system.md`: one entry per user-visible merge); README section under `docs/pranks.md` (how to use, the rails, how to stop).
- [ ] Tests: vitest for the route and the list; sandbox: after a `swap` completes the target context shows the toast and the list has one row.

Suggested order: 0, 1, 2, 3, 4, 8, 5, 7, 9, then 6 if needed. Tasks 1 to 4 give the owner a working web and desktop prank tool; 5 brings Android; 7 the automation; 8 and 9 the polish. Each is shippable on its own because the receiver acks `engine-unsupported` for anything it cannot do yet, and the log shows it in words.

---

## 10. Open questions for the owner (with recommendations)

1. **Opt-out default.** Pranks allowed by default with a visible Settings toggle and a first-time toast (recommended), or opt-in? Recommendation: allowed by default; it is your friends' server and they will hear about the feature from you before the first quack.
2. **Reveal.** After each prank a quiet "You just got pranked by Aron" toast plus a "Pranks on you" list in Settings (recommended), reveal live (spoils it), or never (they will file bug reports about the app sounding wrong)? Recommendation: after.
3. **Only while listening.** Deliver sounds only while their music is actually playing, and swaps only while playing and not paused (recommended, and it sidesteps browser autoplay rules), or also fire sounds at a paused or idle app? Recommendation: only while playing.
4. **Swap sources.** Library uploads only, or also any song from the catalogue by name (search)? Recommendation: both; it costs one picker and no new storage, and "same song name, different song" is the funniest version.
5. **Prank song start.** Default the prank file to start from its beginning while the seek bar keeps counting from where the real song was (recommended, the intro is the joke), or start it at the same timestamp? Recommendation: from the start, with the other as a per-prank switch.
6. **Duck level and cap.** Music at 30% under a sound, sounds capped at 30 s, swaps at 5 min, 20 pranks per person per hour, schedules at least every 60 s for at most 2 h? Recommendation: keep these numbers; every one is a constant in `lib/pranks/limits.ts`.
7. **Who may prank.** Every `is_admin` user, or only you? Recommendation: every admin (the log names the issuer), since that is the existing trust boundary; a `prank_admins` allowlist is a one-line change later.
8. **Android lock-screen tell.** During a swap the lock-screen progress bar shows the prank file's length. Accept it (recommended) or spend more native work hiding it? Recommendation: accept; the notification title, artist and art are the parts people look at.
9. **Formats.** Hint the upload dialog toward mp3/m4a (recommended, both engines decode them natively) or allow anything the member uploads route accepts?
10. **Desktop log tell.** The Rust engine logs every loaded URL at INFO, so a curious target can read `/api/pranks/media/...` in the desktop log. Accept (recommended) or redact prank URLs in `log_audio`?

## Owner decisions (2026-09-23), these override the plan above

1. **No opt-out at all.** Drop the per-user "Let admins prank me" setting, its user field, its Settings row and the first-time toast. Every Ember user can be pranked. The global off switch (admin setting) stays.
2. **Never tell the victim.** Drop the after-prank reveal toast and the "Pranks on you" list (Task 9 shrinks to `docs/pranks.md` and the changelog entry). Nothing on the target's side may reveal that a prank happened; only the admin log knows.
3. **Swap sources: both** uploaded prank songs and any catalogue song picked by name.
4. **Limits as recommended:** duck 30%, sounds 30 s max, swaps 5 min max, 20 per person per hour, 15 s gap, schedules between 60 s and 2 h, 45 s delivery expiry.
5. The remaining questions take the plan's recommendations: sounds and swaps only while music is playing; the prank song starts from its beginning while the bar keeps counting; every `is_admin` user may prank, issuer logged; the Android lock-screen length tell is accepted; upload hint mp3/m4a; the desktop log line is accepted.
6. **Branch:** all of this lands on `plan-23-9` (not `admin-pranks`).
