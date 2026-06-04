# Bug-report logging — design

**Status:** v1 design (capture + send, no AI)
**Owner:** ParalelSt
**Date:** 2026-06-04

## Goal

Let the host (or any signed-in user) hit a "Report a bug" button anywhere in
the app and have a Discord message land in their server containing:

- Last few minutes of server-side errors.
- Client-side errors + breadcrumb trail for the current session.
- Client-side logs from the *previous* session (recovered from `localStorage`).
- The user's optional free-text note about what they were doing.

No AI summarization in v1 — Discord is the durable record; the AI layer is a
follow-up spec.

## Non-goals

- Live error dashboards / metrics — Discord is the read surface.
- Sharing reports across users — bug reports flow to the *self-hoster's* Discord,
  i.e. each deployment is its own audience.
- Email delivery — out of scope; Discord webhook only.
- Replaying user sessions — only structured events, not DOM recordings.

## Architecture

Two loggers feed one delivery channel.

```
┌─ Browser ───────────────────────────┐    ┌─ Server (Next + PB) ─────────────┐
│ • window.onerror, unhandledrejection│    │ • API route try/catch → log       │
│ • <AppErrorBoundary>                │    │ • Middleware errors → log         │
│ • api.ts fetch failures             │    │ • runPython rejections → log      │
│ • <audio> playback errors           │    │                                   │
│ • Breadcrumbs: route changes, plays,│    │ Appends to:                       │
│   playlist mutations, signin events │    │ logs/errors-YYYY-MM-DD.jsonl      │
│                                     │    │ (gitignored, 2-day rotation)      │
│ Stores in:                          │    └───────────────────────────────────┘
│ • In-memory ring buffer (200 items) │
│ • localStorage on pagehide (prev.)  │                  ▲
└─────────────────────────────────────┘                  │
              │                                          │
              └────────► POST /api/bug-report ───────────┘
                         (user clicks "Report bug")
                                   │
                                   ▼
                       Reads recent server logs +
                       client logs + user note,
                       posts to Discord webhook
                       as a formatted message
                       with full payload as
                       a report.json attachment.
```

## Components

### Client logger — `apps/web/lib/logger/client.ts`

Singleton exported as `logger`. Since `app/layout.tsx` is a server component,
the logger is mounted via a tiny client wrapper `<LoggerInit />` rendered
inside `<AuthProvider>`. `LoggerInit` is a `'use client'` component whose
`useEffect` boots the logger once on first render. Idempotent — repeat mounts
return the same instance.

**Captured sources**

| Source | Hook | Type |
|---|---|---|
| Unhandled JS exceptions | `window.addEventListener('error', …)` | `error` |
| Unhandled promise rejections | `window.addEventListener('unhandledrejection', …)` | `error` |
| React render errors | New `<AppErrorBoundary>` wrapping `<PlayerProvider>` children | `error` |
| Failed API calls | `req()` in `apps/web/lib/api.ts` — catch → log → rethrow | `error` |
| Audio playback errors | `'error'` event on the `<audio>` in `PlayerProvider` | `error` |
| Route changes | `usePathname()` effect in a global mount component | `breadcrumb` |
| Playback events | Track start/end/pause from `PlayerProvider` | `breadcrumb` |
| Library mutations | `useExecute*` hooks log on `onSuccess` / `onError` | `breadcrumb` |
| Auth events | `AuthProvider` logs signin / signup / signout | `breadcrumb` |

**Entry shape**

```ts
interface LogEntry {
  ts: number;                     // ms since epoch
  kind: 'error' | 'breadcrumb';
  level: 'error' | 'info';
  category: string;               // 'api' | 'audio' | 'route' | 'playback' | 'auth' | 'library' | 'js' | 'react'
  message: string;
  data?: unknown;                 // structured extras (route, status, trackId)
  stack?: string;                 // errors only
  sessionId: string;              // random uuid generated at boot
}
```

**Storage**

- **Current session:** in-memory ring buffer, capped at 200 entries (drops oldest).
- **Last session:** on `pagehide`, flush the ring buffer to `localStorage` under
  key `ember.logs.last`. Capped at ~256 KB; truncates oldest if over. On next boot,
  that value becomes the "previous session" archive.
- **Submission:** `logger.snapshot()` returns
  `{ current: LogEntry[]; previous: LogEntry[]; sessionId: string }`.

**API surface**

```ts
logger.error(category: string, message: string, data?: unknown, err?: Error): void
logger.breadcrumb(category: string, message: string, data?: unknown): void
logger.snapshot(): { current: LogEntry[]; previous: LogEntry[]; sessionId: string }
```

**Scrubbing** — before submission, the snapshot runs through a sanitizer that:

- Strips any field literally named `password`, `token`, `cookie`, `authorization`
  (case-insensitive).
- Truncates strings longer than 4 KB.
- Leaves everything else intact (no email scrubbing — reports go to the
  self-hoster, no cross-user leakage).

### Server logger — `apps/web/lib/logger/server.ts`

Server-only. Imported by route handlers via `fromError` and by `proxy.ts`.

**Captured sources**

| Source | Hook | Type |
|---|---|---|
| API route errors | Update `fromError` in `lib/upsertTrack.ts` → also write to JSONL | `error` |
| Middleware errors | `proxy.ts` try/catch → log | `error` |
| Python failures | `runPython` reject path → log | `error` |

**Entry shape** — `LogEntry` plus:

```ts
interface ServerLogEntry extends LogEntry {
  side: 'server';
  reqId: string;                  // generated per request via middleware
  route: string;                  // pathname
  userId?: string;                // resolved from auth cookie if signed in
}
```

**Storage**

- Files at `logs/errors-YYYY-MM-DD.jsonl` in the repo root.
- One line per entry, JSON.
- Append-only via `fs.appendFile` (async, fire-and-forget — failures don't block
  the caller).
- **Boot sweep:** on server startup, delete any `logs/errors-*.jsonl` older than
  2 days. One-time scan, no cron.

**API surface**

```ts
serverLogger.error(
  category: string,
  message: string,
  data?: unknown,
  err?: unknown,
  ctx?: { reqId: string; route: string; userId?: string },
): void
serverLogger.recentSince(timestampMs: number): Promise<ServerLogEntry[]>
```

`recentSince` reads today's + yesterday's JSONL files, parses each line, filters
by `ts > timestampMs`.

### Bug-report endpoint — `app/api/bug-report/route.ts`

```ts
POST /api/bug-report
```

- **Auth:** `requireUser` — only signed-in users can submit.
- **Body:** `{ note?: string; client: { current: LogEntry[]; previous: LogEntry[]; sessionId: string } }`
- **Behavior:**
  1. Load `serverLogger.recentSince(Date.now() - 5*60*1000)` — last 5 minutes.
  2. Build a Discord message:
     - **Title:** `Bug report from <email>`
     - **Description:** the user's note (or `(no note)`).
     - **Embed fields:** counts (errors current/prev, breadcrumbs current/prev,
       server errors), `sessionId`, user-agent, app URL.
     - **Attachment:** `report.json` containing the full structured payload
       (client current + client previous + server slice + meta).
  3. POST as `multipart/form-data` to `DISCORD_BUG_REPORT_WEBHOOK_URL`.
  4. Returns `{ ok: true }`; on Discord failure, surfaces Discord's message in a 502.
- **Webhook not configured:** returns 503 with
  `{ error: 'Bug reporting not configured' }`. UI toasts a clear message.

### UI

**Button placement.** Entry in the user dropdown / sidebar footer next to
"Sign out". On mobile, surfaced in the same Drawer menu. Not on the top bar —
bug reporting is rare enough that it doesn't need primary real estate.

**Dialog component** — `components/BugReportDialog.tsx`, reuses shadcn `Dialog`.

```
┌─ Report a bug ───────────────────┐
│ What happened? (optional)         │
│ ┌─────────────────────────────┐  │
│ │ <textarea, 4 rows>          │  │
│ └─────────────────────────────┘  │
│                                   │
│ ◯ Diagnostic data: 47 events      │
│   from this session, 312 events   │
│   from your last session.         │
│   Sent to your Discord channel.   │
│                                   │
│        [Cancel]  [Send report]    │
└───────────────────────────────────┘
```

- Textarea: optional, max 1000 chars.
- Diagnostic summary computed from `logger.snapshot()` counts.
- Submit enabled with empty note (data alone is useful).
- While submitting, button shows "Sending…" and disables.
- On success: toast `Report sent`, dialog closes.
- On failure: toast with the error message, dialog stays open.
- Cancel / Esc closes without sending.

**Open state.** Controlled by a new `bugReportOpen` flag in a tiny new
`stores/useUiStore.ts` (separate from `usePlayerStore` to keep concerns clean)
so any component can trigger the dialog (sidebar, drawer, future error-toast
"Send report" action).

### Environment

Add to `apps/web/.env.example`:

```
# Bug-report Discord webhook URL.
# Create in: Server Settings → Integrations → Webhooks → New Webhook → copy URL.
DISCORD_BUG_REPORT_WEBHOOK_URL=
```

## Data flow

1. App boots → `logger` initializes, generates `sessionId`, hydrates from
   `localStorage` (becomes `previous`), starts the ring buffer for `current`.
2. App runs → errors and breadcrumbs append to the ring buffer; the buffer drops
   oldest when full.
3. On `pagehide` → ring buffer flushed to `localStorage` under `ember.logs.last`.
4. User clicks Report-a-bug → dialog opens → user types optional note →
   clicks Send.
5. Client: `logger.snapshot()` → scrub → POST to `/api/bug-report`.
6. Server: reads last 5 minutes of `logs/errors-*.jsonl` → builds Discord
   payload → POSTs to webhook → returns success.
7. UI toasts result.

## Edge cases

- **Webhook not configured.** API returns 503; UI toasts a clear message
  pointing at the env var.
- **Logger recursion.** Every public logger method wraps its body in
  `try/catch` and uses `console.warn` (not `console.error`) on internal
  failures, so the wrapper doesn't loop on itself.
- **localStorage quota.** If writing exceeds quota, drop the oldest half of
  `ember.logs.last` and retry once. If still failing, skip persistence — the
  current session still works.
- **Multi-tab.** Each tab generates its own `sessionId`. `localStorage` last-session
  archive overwrites on `pagehide`; last tab to leave wins. Acceptable for a
  single-user app.
- **Discord payload size.** Discord webhook max payload is ~8 MB. Snapshot is
  capped at ~512 KB total before send; if larger, drop oldest breadcrumbs first,
  then oldest non-fatal errors. Errors are preferred over breadcrumbs.
- **Privacy in shared deployments.** Reports flow to the *self-hoster's*
  Discord. SETUP.md should call this out for friends who self-host: their
  reports go to their own webhook, not yours.

## Testing

- **Manual checks** (the realistic path for this app):
  - Trigger a known error (e.g. break a track URL in DevTools) → confirm it
    shows in the next bug report.
  - Submit with empty note → confirm Discord receives the report.
  - Refresh the page → submit again → confirm previous-session logs included.
  - Unset webhook env → confirm graceful 503 + toast.
- **Unit tests:** Vitest `lib/logger/sanitize.test.ts` covers the scrubber:
  given input with `password`, `token`, deep nesting, strings > 4 KB, asserts
  the output is correct.
- **No e2e** — overkill for this app.

## Rollout / implementation order

1. Logger primitives — `lib/logger/client.ts`, `lib/logger/server.ts`,
   `lib/logger/sanitize.ts` (with tests).
2. Hook into `api.ts`, `proxy.ts`, `fromError`, `runPython`, audio element,
   `AuthProvider`, `useExecute*` hooks — no UI yet, but the data starts
   flowing.
3. `<AppErrorBoundary>` wraps `{children}` inside `<PlayerProvider>` so
   render errors in any page are caught. Route-change breadcrumb effect lives
   in a client `<RouteBreadcrumb />` mounted alongside `<LoggerInit />`.
4. `/api/bug-report` endpoint + Discord delivery + 2-day file rotation.
5. `useUiStore` + `BugReportDialog` + sidebar/drawer entry points.
6. `.env.example` update + a paragraph in `SETUP.md` for creating the webhook.
7. Manual test pass.

## Files added/changed

**New:**
- `apps/web/lib/logger/client.ts`
- `apps/web/lib/logger/server.ts`
- `apps/web/lib/logger/sanitize.ts`
- `apps/web/lib/logger/sanitize.test.ts`
- `apps/web/components/BugReportDialog.tsx`
- `apps/web/components/AppErrorBoundary.tsx`
- `apps/web/components/LoggerInit.tsx` — client wrapper that boots the logger
  and registers the route-change breadcrumb effect.
- `apps/web/stores/useUiStore.ts`
- `apps/web/app/api/bug-report/route.ts`

**Modified:**
- `apps/web/app/layout.tsx` — mount ErrorBoundary, init client logger,
  render BugReportDialog.
- `apps/web/lib/api.ts` — log failed requests.
- `apps/web/proxy.ts` — log middleware errors, add reqId.
- `apps/web/lib/upsertTrack.ts` — `fromError` also writes to server log.
- `apps/web/lib/sources/youtube.ts` — `runPython` rejects also log.
- `apps/web/components/player/PlayerProvider.tsx` — audio-error listener,
  playback breadcrumbs.
- `apps/web/components/providers/AuthProvider.tsx` — auth-event breadcrumbs.
- `apps/web/components/nav/Sidebar.tsx`, `Drawer.tsx` — "Report a bug" entry.
- `apps/web/.env.example` — webhook URL.
- `.gitignore` — `logs/`.
- `SETUP.md` — webhook creation instructions.

## Open questions

- Should breadcrumbs include text the user *typed* (search queries, playlist
  names)? Risk: leaking taste data into Discord. Default: **no**, only category
  + presence flag (e.g. `searched=true` without the query). Revisit if reports
  are hard to interpret without query context.
- Do we want a "Don't send" toggle for the diagnostic data (note-only report)?
  Default: **no** — data is the whole point of the feature, and the
  self-hoster trusts themselves.

## Future (v2)

- AI summary layer: an LLM call before Discord delivery that produces a short
  "likely cause + suspected files" preface alongside the raw logs.
- Email channel as an alternative to Discord.
- A `/admin/logs` page that reads server JSONL files (or query the PB
  collection if we ever move there) for ad-hoc inspection.
