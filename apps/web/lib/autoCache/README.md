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
