# Bug-report logging — implementation plan

Plan derived from [`2026-06-04-bug-report-logging-design.md`](../specs/2026-06-04-bug-report-logging-design.md).
Each step is independently verifiable; later steps depend on earlier ones.

## Step 1 — Logger primitives + sanitizer

**Goal:** ship the logger module + sanitizer, with unit tests for the
sanitizer. Nothing else in the app uses them yet.

**Files to create**
- `apps/web/lib/logger/types.ts` — shared `LogEntry`, `ServerLogEntry`,
  `ClientSnapshot` types.
- `apps/web/lib/logger/sanitize.ts` — pure functions:
  - `scrub(value: unknown): unknown` — recursive walk, strips fields named
    `password`/`token`/`cookie`/`authorization` (case-insensitive), truncates
    strings > 4 KB.
  - Exported `MAX_STRING_LEN = 4096`, `SCRUBBED_KEYS = ['password', 'token', 'cookie', 'authorization']`.
- `apps/web/lib/logger/sanitize.test.ts` — Vitest covering:
  - field stripping (case insensitive, nested)
  - string truncation marker
  - cycles / unserializable values handled
- `apps/web/lib/logger/client.ts` — singleton `logger`:
  - `sessionId` uuid generated at construction.
  - In-memory ring buffer (Array capped at 200, drops oldest).
  - `previous: LogEntry[]` hydrated from `localStorage['ember.logs.last']` at boot.
  - `error(category, message, data?, err?)`, `breadcrumb(category, message, data?)`, `snapshot()`.
  - Every public method wrapped in try/catch falling back to `console.warn`.
- `apps/web/lib/logger/server.ts` — server logger:
  - `error(category, message, data?, err?, ctx?)` — appends a line to
    `<repo>/logs/errors-<YYYY-MM-DD>.jsonl` via `fs.appendFile` (non-blocking).
  - `recentSince(ts: number): Promise<ServerLogEntry[]>` — reads today's + yesterday's files.
  - Boot sweep: on module load, scan `logs/` and unlink files whose name date is older than 2 days.
  - `path` resolved relative to `process.cwd()`.
- `.gitignore` — append `logs/`.

**Verify**
- `npx vitest run lib/logger/sanitize.test.ts` (or just `npm test`) passes.
- `npx tsc --noEmit` passes.
- Nothing else changed in the app (smoke: `npm run dev` still serves
  `localhost:3000`).

## Step 2 — Wire logger into existing modules (no UI)

**Goal:** errors and breadcrumbs start flowing into the buffers / files; still
no way to send a report. Confirm via `console.log(logger.snapshot())` in
DevTools.

**Files to edit**
- `apps/web/lib/api.ts` — in `req()`, on non-OK response or thrown error, call
  `logger.error('api', \`\${method} \${path} failed\`, { status, body })` *before* re-throwing.
- `apps/web/proxy.ts` — wrap the body in try/catch; on error, `serverLogger.error('middleware', ..., err, { reqId, route })`. Generate `reqId` (random 8-char) and stash in request headers via `response.headers.set('x-req-id', reqId)`.
- `apps/web/lib/upsertTrack.ts` — `fromError` calls `serverLogger.error('api', ..., err, ctx)` in addition to `console.error`. (Keep `console.error` since the user reads it in the terminal.)
- `apps/web/lib/sources/youtube.ts` — `runPython` rejection paths add `serverLogger.error('python', ..., err)`.
- `apps/web/components/player/PlayerProvider.tsx`:
  - On audio element creation: register `'error'` event → `logger.error('audio', 'audio element error', { code, message })`.
  - In `playTrack`, after `setIndex`, `logger.breadcrumb('playback', 'play', { trackId, source })`.
  - In `next`, `prev`, `toggle`, breadcrumb each.
- `apps/web/components/providers/AuthProvider.tsx` — `logger.breadcrumb('auth', 'signin'|'signup'|'signout', { userId })` in the corresponding handlers.
- `apps/web/hooks/useLibrary.ts` — for each `useExecute*` hook, `onSuccess`/`onError`:
  - `onSuccess`: `logger.breadcrumb('library', '<verb>', { …minimal context })`.
  - `onError`: `logger.error('library', '<verb> failed', { …context }, err)`.

**Verify**
- Open DevTools, navigate around, play tracks, then in console:
  ```js
  // expose for testing
  (await import('/lib/logger/client')).logger.snapshot()
  ```
  See breadcrumbs.
- Trigger a known failure (e.g. unset webhook + try to create playlist) → see the error in `logger.snapshot().current` and a fresh JSONL line in `logs/`.
- `npx tsc --noEmit` passes.

## Step 3 — Boundary + boot + route-change breadcrumb

**Goal:** React render errors caught; logger initialized in a client wrapper;
route changes recorded as breadcrumbs.

**Files to create**
- `apps/web/components/AppErrorBoundary.tsx` — class component that catches
  errors in `componentDidCatch`, calls `logger.error('react', errorMessage, { componentStack }, err)`, renders a small fallback ("Something broke. We've logged it. Reload?").
- `apps/web/components/LoggerInit.tsx` — `'use client'`:
  - `useEffect` → calls a `logger.boot()` (idempotent) and registers the route-change breadcrumb via `usePathname()`.
  - Returns `null`.

**Files to edit**
- `apps/web/app/layout.tsx` — mount `<LoggerInit />` inside `<AuthProvider>` (before `<PlayerProvider>`). Wrap `<PlayerProvider>` children with `<AppErrorBoundary>`.

**Verify**
- Throw a deliberate error in a component (`throw new Error('test')`) — see the fallback UI; verify `logger.snapshot()` includes the error.
- Navigate routes — see route-change breadcrumbs.
- `npx tsc --noEmit` passes.

## Step 4 — Bug-report API + Discord delivery

**Goal:** server endpoint that accepts a snapshot, stitches server logs, posts
to Discord. Webhook URL config'd via env.

**Files to create**
- `apps/web/app/api/bug-report/route.ts`:
  - `POST` handler, `requireUser`.
  - Body validated with a tiny zod schema (`{ note?: string; client: ClientSnapshot }`).
  - Loads `serverLogger.recentSince(Date.now() - 5*60*1000)`.
  - Builds payload + Discord message (formatted embed + `report.json` attachment).
  - Reads `process.env.DISCORD_BUG_REPORT_WEBHOOK_URL`; returns 503 if empty.
  - POSTs to webhook as `multipart/form-data` (Node 20+ has `FormData`/`Blob` natively).
  - Returns `{ ok: true }` or surfaces Discord's error in a 502.

**Files to edit**
- `apps/web/.env.example` — append `DISCORD_BUG_REPORT_WEBHOOK_URL=`.
- `apps/web/proxy.ts` — add `/api/bug-report` to `PUBLIC_API_PREFIXES` so the
  middleware proxy doesn't redirect it. (It still requires auth via the route
  handler's `requireUser`.)

**Verify**
- Set `DISCORD_BUG_REPORT_WEBHOOK_URL` in `.env.local` to your test channel webhook.
- `curl -X POST http://localhost:3000/api/bug-report -H 'Content-Type: application/json' --cookie 'pb_auth=…' -d '{"note":"test","client":{"current":[],"previous":[],"sessionId":"00000000-0000-0000-0000-000000000000"}}'` → expect 200 + Discord message arrives.
- Unset env → expect 503.

## Step 5 — UI dialog + entry points + UI store

**Goal:** "Report a bug" entry in the sidebar/drawer opens the dialog;
submitting posts to the API.

**Files to create**
- `apps/web/stores/useUiStore.ts` — zustand store with `bugReportOpen: boolean` + `setBugReportOpen`. Not persisted.
- `apps/web/components/BugReportDialog.tsx`:
  - `open`/`onOpenChange` from `useUiStore`.
  - Textarea (optional, max 1000), diagnostic summary line computed from `logger.snapshot()` counts.
  - On submit: `fetch('/api/bug-report', { method: 'POST', body: JSON.stringify({ note, client: snapshot }), credentials: 'include' })` → toast success / error.

**Files to edit**
- `apps/web/components/nav/Sidebar.tsx` — add a "Report a bug" button near "Sign out" that calls `setBugReportOpen(true)`.
- `apps/web/components/nav/Drawer.tsx` — same on mobile.
- `apps/web/app/layout.tsx` — render `<BugReportDialog />` at the layout root (after the providers, before `<Toaster />`).

**Verify**
- Click "Report a bug" → dialog opens.
- Submit empty → Discord message arrives with `(no note)`.
- Submit with note → Discord includes the note.
- Refresh page, do stuff, submit again → previous session's events present in the JSON attachment.

## Step 6 — Docs + cleanup

**Files to edit**
- `SETUP.md` — short section under "First time" or as a new section:
  ```
  ## Bug reports (optional)

  Create a Discord webhook (Server Settings → Integrations → Webhooks),
  paste the URL into `apps/web/.env.local`:

      DISCORD_BUG_REPORT_WEBHOOK_URL=https://discord.com/api/webhooks/…

  Then the "Report a bug" button in the sidebar will deliver structured
  diagnostics + your note to that channel.
  ```
- `apps/web/.env.example` — already updated in Step 4; verify it has the entry.

**Verify**
- Full manual test pass per the spec's Testing section.
- Spec's "Files added/changed" list matches reality.

## Step 7 — Commit + push

One commit per step is overkill for this scale; **two commits**:

1. Steps 1–3 (logger infra + capture wiring + boundary).
2. Steps 4–6 (API + UI + docs).

Each with a `Co-Authored-By: Claude Opus 4.7` trailer.

## Out of scope (v2)

- AI summary layer.
- Email delivery.
- An admin `/logs` viewer.
- Cross-tab session correlation.
