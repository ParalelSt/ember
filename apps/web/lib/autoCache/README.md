# Auto cache prefetch policy

`policy.ts` decides WHAT should be on disk (the current track and the next 2
playable) and WHEN one more prefetch download may start. It is pure: no store,
no DOM, no clock of its own. Web and desktop drive it through `useAutoCache`;
Android mirrors it in Kotlin inside `EmberPlaybackService`.

`policy.cases.json` is the contract. A port is correct when it passes every
case in it. Change the TS, this README and the table together.

## Numbers (`POLICY`)

| Name | Value | Meaning |
|---|---|---|
| `N` | 2 | tracks after the current one |
| `MIN_PLAYED_SEC` | 15 | seconds of the current track played before any prefetch |
| `BUFFER_FALLBACK_SEC` | 45 | seconds played that stand in for "fully buffered" when the platform cannot tell |
| `MAX_ATTEMPTS` | 3 | answers per id per session before it is dropped |
| `BACKOFF_SEC` | 15, 30, 60, 120 | wait after answer k (1-based) is `BACKOFF_SEC[min(k, 4) - 1]` |
| `RETRY_AFTER_CAP_SEC` | 120 | a server Retry-After is clamped to this |
| `BUSY_DEFAULT_SEC` | 30 | wait after a 503 with no usable Retry-After |
| `EXPECTED_BYTES_DEFAULT` | 6291456 (6 MiB) | download size assumed when none is known |

## Input

All times are milliseconds except `playedSec`. Maps and sets are keyed by the
Ember track id (`youtube:<videoId>`, `upload:<...>`).

| Field | Type | Notes |
|---|---|---|
| `queue` | `{ id, streamUrl?, unavailableAt? }[]` | play order (shuffle is already applied) |
| `index` | int | current track; out of range means nothing is playing |
| `loopMode` | `off` / `all` / `one` | |
| `context` | `{ type } \| null` | only `type` is read (`playlist` changes the wrap point) |
| `baseCount` | int | curated list size before radio extended the queue |
| `playedSec` | number | seconds of the current track played |
| `bufferedToEnd` | bool or null | null = platform cannot tell |
| `playing` | bool | informational only, never gates |
| `online`, `saveData`, `batterySaver` | bool | |
| `metered` | bool or null | null = unknown = not metered |
| `enabled`, `allowMetered` | bool | device settings `autoCacheEnabled`, `autoCacheOnMetered` |
| `requestCurrent` | bool | web true; Android and desktop false (their players write the current track through) |
| `cached` | set of ids | ids fully in the auto cache |
| `inFlight` | id or null | the one prefetch download running |
| `bytes`, `cap` | number | total auto cache bytes, and its cap |
| `sizes` | map id -> bytes (optional) | on-disk size per cached id; missing = 0 |
| `expectedBytes` | map id -> bytes (optional) | expected download size; missing = `EXPECTED_BYTES_DEFAULT` |
| `backoffUntil` | map id -> ms | earliest time an id may be tried again |
| `attempts` | map id -> count | answers used per id this session |
| `nowMs` | number | the clock (tests use a fake one) |

## Functions

**`desiredIds(input) -> id[]`**, priority order.
1. `index` out of range: `[]`.
2. The current track first, if it is streamable (has an id, a non-empty
   `streamUrl`, and an empty or missing `unavailableAt`).
3. Walk like the player's Next: `move = nextIndex(state at i)`; stop on null;
   `r = nextPlayable(queue, move.index, +1, wrap = loopMode == all)`; stop when
   `r.index < 0` or `r.index` was already landed on (the start index counts as
   landed). A landing that is not streamable, or whose id is already listed, is
   passed over without using a slot. Stop after N listed.
4. `nextIndex`: under loop-all, wrap to 0 when `index >= wrapPoint - 1`
   (`wrapPoint` = `min(baseCount, len)` for a `playlist` context with
   `baseCount > 0`, else `len`); otherwise `index + 1` while inside the queue;
   otherwise wrap to 0 under loop-all, else null. Loop-one behaves as off.

**`nextAction(input) -> action`**. First match wins:
1. `!enabled` -> idle `disabled`
2. `!online` -> idle `offline`
3. `batterySaver` -> idle `battery`
4. `saveData` -> idle `metered` (even with `allowMetered`)
5. `metered == true && !allowMetered` -> idle `metered`
6. `inFlight != null`: in `desiredIds` -> idle `busy`; otherwise `{ abort, id }`
7. `!(playedSec >= 15)`, or `bufferedToEnd == false`, or
   (`bufferedToEnd == null && !(playedSec >= 45)`) -> idle `not-settled`
8. `room = cap - bytes + reclaimable`, where reclaimable is the sum of `sizes`
   over cached ids outside the protected set (see eviction). For each id of
   `desiredIds` in order: skip the current track's id when `!requestCurrent`;
   skip if cached; skip if `attempts >= 3`; skip if `backoffUntil > nowMs`
   (remember the smallest such time); skip if expected size `> room`;
   otherwise `{ start, id }`.
9. Something skipped for backoff -> idle `backoff` with `wakeAtMs` = the smallest
   `backoffUntil` seen. Only this reason carries `wakeAtMs`.
10. Something skipped for size -> idle `cap`.
11. idle `nothing`.

Gates 1 to 5 never abort an in-flight download; the driver decides whether
to cancel (for example when the listener turns the setting off).

**`onResult(input, id, result) -> { backoffUntil, attempts, drop }`**. Returns
new maps; other ids are untouched.
- `done`: remove `id` from both maps; `drop = false`.
- `gone` (410): remove the backoff, set `attempts = 3`; `drop = true`.
- `retry-after` (429 or 503) and `failed`: `k = attempts + 1` is stored.
  Wait: Retry-After seconds if present, finite and `>= 0`, clamped to 120;
  else 30 for a 503; else `BACKOFF_SEC[min(k, 4) - 1]`. Store
  `backoffUntil = nowMs + wait * 1000`. `drop = k >= 3`.
- Feeding the maps back in keeps a dropped id out, since its attempts are 3.

**`evictionOrder(input, lastUsed) -> id[]`**. Cached ids minus the protected
set (the current track's id, even when it cannot be streamed, plus
`desiredIds`), sorted by `lastUsed` ascending; a missing `lastUsed` is the
oldest; ties sort by id (plain string order).

**`evictToFit(input, lastUsed, incomingBytes) -> { evict, fits }`**. If
`bytes + incomingBytes <= cap`: `{ [], true }`. Else take ids from
`evictionOrder` one by one, subtracting `sizes[id]` (missing = 0), until it
fits: `{ taken, true }`. If it never fits: `{ [], false }` (delete nothing, skip
the write).

## The case table

`policy.cases.json` is one object:

- `defaults.input`: a complete input. Each case's `input` is shallow-merged over
  it (a key replaces the default whole).
- `cached` is a JSON array; `sizes`, `expectedBytes`, `backoffUntil`, `attempts`
  and `lastUsed` are JSON objects keyed by id.
- `policy[]`: `{ name, input, expectedDesired, expectedAction }`.
- `onResult[]`: `{ name, input, steps[] }`; each step is
  `{ id, result, nowMs?, expected }` and feeds its `backoffUntil` and
  `attempts` into the next step.
- `evictionOrder[]`: `{ name, input, lastUsed, expected }`.
- `evictToFit[]`: `{ name, input, lastUsed, incomingBytes, expected }`.

Result shapes are JSON as written above: `{ "kind": "start", "id": ... }`,
`{ "kind": "idle", "reason": ..., "wakeAtMs"?: ... }`, and for results
`{ "kind": "retry-after", "status": 503, "seconds": null }`, `{ "kind": "gone" }`,
`{ "kind": "failed" }`, `{ "kind": "done", "bytes": ... }`.

Android and desktop ports read this file from here (copy it into their test
resources with a build step, or commit a copy plus a test asserting it is
byte-identical); the vitest suite `policy.test.ts` runs every case.

## Driving it: `CacheAdapter` and `useAutoCache`

`hooks/player/useAutoCache.ts` (mounted once by `PlayerProvider`) runs the
policy on every platform through one interface, `CacheAdapter` in
`adapter.ts`. `driver.ts` holds the loop (framework-free); the hook wires it
to the stores and decides when to tick: on a track change, play/pause, queue
and loop changes, a settings change, a connection change, and every 5 s while
a song plays (the 15 s and "fully buffered" gates are crossed by the clock).

```ts
export type CacheAdapterKind = 'opfs' | 'tauri' | 'android-native' | 'none';
export interface CacheEntry { bytes: number; lastUsedAt: number }
export interface CacheStats { bytes: number; count: number; cap: number }

export interface CacheAdapter {
  readonly kind: CacheAdapterKind;
  readonly writesThrough: boolean;
  ready(): Promise<boolean>;
  has(id: string): boolean;
  localSrcFor(id: string): string | null;
  prefetch(track: Track, signal: AbortSignal): Promise<FetchResult>;
  touch(id: string): void;
  evict(ids: string[]): Promise<void>;
  entries(): ReadonlyMap<string, CacheEntry>;
  stats(): CacheStats;
  clear(): Promise<void>;
  subscribe?(listener: () => void): () => void;
}
```

What each member must do:

| Member | Contract |
|---|---|
| `kind` | which store this is; `'none'` makes Settings say caching is not available |
| `writesThrough` | true when the player itself keeps the current track (Android SimpleCache, the desktop stream temp file); the driver then passes `requestCurrent = false` |
| `ready()` | load the index; resolve false (never reject) when the device or shell cannot cache, for example an old app without the cache commands |
| `has(id)` | sync, from memory: fully on disk |
| `localSrcFor(id)` | sync: a URL the CURRENT engine can load, else null. OPFS returns a blob: URL; desktop and Android return null |
| `prefetch(track, signal)` | download `apiUrl(track.streamUrl)` with `?prefetch=1` (`withPrefetchParam`), write it under the id, and resolve the `FetchResult` for `onResult` (`resultForStatus` maps 429/503 with Retry-After, 410 and other errors). Never reject. On abort, clean up and resolve anything: an aborted result is ignored |
| `touch(id)` | lastUsedAt = now; no-op for an unknown id |
| `evict(ids)` | delete these (unknown ids ignored). The driver only asks for what `evictToFit` returned, so never the current track or the window |
| `entries()` | sync snapshot id -> `{ bytes, lastUsedAt }`; feeds `cached`, `sizes` and the eviction order |
| `stats()` | totals and the cap (web: min(250 MB, half the quota); desktop 500 MB; Android 300 MB) |
| `clear()` | delete everything auto-cached; never pinned downloads |
| `subscribe` | optional: for adapters whose contents change outside the driver (the native Android cache); the hook refreshes the UI on each call |

The driver downloads at most one id at a time, evicts with `evictToFit`
before each write (the expected size is `durationSec` x 20 kB/s, else the
policy default), trims again by the real size after a download, cancels the
download in flight when the policy says `abort` or a device gate (disabled,
offline, battery, metered) closes, and sets one timer for a `backoff` wake.

### Plugging a platform in

`select.ts` maps the engine PlayerProvider picked to an adapter:

| Engine | Adapter | Notes |
|---|---|---|
| `web`, `capacitor` | `opfsAdapter.ts` | blob: URLs the audio element plays; `noneAdapter` without OPFS |
| `tauri-native` | `tauriAdapter.ts` | the shell's `cache_*` commands; `localSrcFor` is null, the engine opens the file by `LoadOptions.cacheKey` |
| `android` | `androidAdapter.ts` | a mirror of the native player's own cache: never downloads (`prefetch` resolves failed) or evicts; `useAutoCache` runs no driver, only hands the settings down (`setNativeAutoCache`) and mirrors `offline` / `offlineStalled` into `useAutoCacheStore` |
| anything else | `noneAdapter` | |

An app engine (`tauri-native`, `android`) whose adapter resolves `ready()`
false is an app build from before the auto cache: `useAutoCacheStore.needsAppUpdate`
is set and Settings says to update the app. When a broken desktop engine
falls back to web audio, the provider switches the adapter to OPFS too.
A new platform adds one `case` there.

How the player uses the adapter (`PlayerProvider.loadAndPlay`, web and
desktop engines; the Android engine owns its own queue and never asks):

1. a pinned download (`lib/offline*`) wins;
2. else `adapter.localSrcFor(id)`, when non-null, is the URL handed to
   `AudioBackend.load`;
3. `LoadOptions.cacheKey` is set to the track id whenever `adapter.has(id)`
   and no pinned copy was used. The URL is then the stream URL (step 2 gave
   null), so an engine with its own cache (desktop) opens the cached file by
   the key and keeps the URL as its fallback. Web audio ignores `cacheKey`.

`AudioBackend.getBufferedToEnd?()` feeds `bufferedToEnd`: true once the
current track is fully downloaded, false while it still is, null when the
engine cannot tell (absent reads as null). Web audio reads `audio.buffered`.

### Offline behaviour (web and desktop engines)

`useAutoCacheStore.online` (event driven, optimistic at load) is the one
connection signal. Offline, Next and auto-advance use
`queueNav.nextPlayableOffline`: only tracks that are auto-cached or pinned can
be landed on; the rest are skipped without being flagged. Nothing left means a
stall: one toast per offline spell, `offlineStalled = true` (the badge says
"Offline, nothing cached ahead"), no retry loop. A Next pressed mid-song with
nothing ahead only toasts; the song carries on. A song that fails while
offline (its stream gave out, or its cached file vanished; a broken cached
copy is evicted) moves on the same way, and stalls on itself when nothing is
ahead. When the connection returns, the stall clears and the song it stopped
at is loaded paused; the listener presses play. The availability probe asks
the server nothing while offline.

### Tests

`adapter.test.ts`, `opfsAdapter.test.ts` (fake OPFS in
`test-utils/fakeOpfs.ts`), `hooks/player/useAutoCache.test.tsx` (fake adapter,
fake timers), `components/player/PlayerProvider.autoCache.test.tsx`, and the
browser test `tests/auto-cache-ui.test.mjs`.
