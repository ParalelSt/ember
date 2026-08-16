# Tests

Runnable checks against a **sandbox** copy of the app. Nothing here touches
your live PocketBase data, your real Discord channel, or any paid API — the
external services are faked in-process.

> Never point these at the running production stack (`:3000` / `:8090`). The
> whole point of the sandbox is that a test can't damage anything.

## Sandbox setup

From the repo root:

```bash
# 1. Copy the database somewhere disposable
SB=/tmp/ember-sandbox && mkdir -p "$SB" && cp -R pocketbase/pb_data "$SB/pb_data"

# 2. PocketBase on a spare port
./pocketbase/pocketbase serve --http=127.0.0.1:8091 --dir="$SB/pb_data" \
  --hooksDir=pocketbase/pb_hooks &

# 3. Build once (turbopack dev is unreliable here — always test a real build)
cd apps/web && npx next build --webpack

# 4. Two app servers: one WITH an AI key, one WITHOUT.
#    MAX_UPLOAD_MB=1 keeps the uploads "too large" case fast.
POCKETBASE_URL=http://127.0.0.1:8091 MUSIC_DIR="$SB/music" MAX_UPLOAD_MB=1 \
ANTHROPIC_API_KEY=test-key ANTHROPIC_BASE_URL=http://127.0.0.1:4311 \
BUG_TRIAGE_MODEL=claude-sonnet-5 \
DISCORD_BUG_REPORT_WEBHOOK_URL=http://127.0.0.1:4312/hook \
npx next start -p 3005 &

POCKETBASE_URL=http://127.0.0.1:8091 MUSIC_DIR="$SB/music" \
ANTHROPIC_API_KEY= \
DISCORD_BUG_REPORT_WEBHOOK_URL=http://127.0.0.1:4312/hook \
npx next start -p 3006 &
```

`POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD` come from
`apps/web/.env.local`; the tests default to the values in `.env.example`.

## Running

```bash
node tests/ai-triage.test.mjs     # or: npm run test:triage

# UI check — needs a browser driver and the standalone fakes
npm i -D playwright-core
node tests/fake-anthropic.mjs &
node tests/ai-triage-ui.test.mjs  # or: npm run test:triage-ui

# Privacy switches
node tests/privacy.test.mjs                         # or: npm run test:privacy

# Desktop update feed (needs its own server — see the section below)
node tests/desktop-update.test.mjs                  # or: npm run test:update

# Custom uploads (MUSIC_DIR must match the server's)
MUSIC_DIR="$SB/music" node tests/uploads.test.mjs   # or: npm run test:uploads
node tests/uploads-ui.test.mjs                      # or: npm run test:uploads-ui
```

Exit code 0 = everything passed; each check prints PASS/FAIL with detail.

`ai-triage-ui.test.mjs` drives a headless browser: it submits a report as a
throwaway user and checks the diagnosis panel renders, resets on **Done**, and
logs no console errors.

## What `ai-triage.test.mjs` covers

Bug reports get read by Claude before landing in Discord (SETUP.md → "Bug
reports → your Discord channel"). The test stands up a fake Anthropic API and
a fake Discord webhook, then drives the real route:

- **Happy path** — triage reaches both the reporter and the Discord embed;
  the right model, key header and API version go out.
- **Digest quality** — 341 events condense to a bounded prompt, a repeated
  error collapses to `(xN)`, a rare error buried in noise still survives, and
  30 genuinely distinct errors are all preserved.
- **Failure modes** — Anthropic returning 500, prose instead of JSON, or JSON
  missing required fields. In every case the report must still reach Discord
  with `triage: null`. **Triage must never be able to eat a bug report.**
- **No API key** — the default for anyone self-hosting: Anthropic is never
  called and the report sends exactly as before.
- **Rate limit** — one report per user per 30s, unchanged.

## What `uploads.test.mjs` covers

Members can upload their own songs (SETUP.md → "Custom song uploads"). The
test uploads a real generated WAV and checks the whole loop:

- **Shared library** — a *different* member sees the upload in the list, finds
  it in search (ranked above YouTube), and can stream it. Signed-out callers
  get nothing from either.
- **Streaming** — bytes come back byte-identical, with working Range requests
  (206, correct `Content-Range`) and 416 for an impossible range.
- **Validation** — a text file renamed `.mp3` with an audio MIME type is
  rejected on its bytes; oversize and empty files are rejected; a missing
  title falls back to the filename.
- **Path traversal** — a forged record whose filename escapes the uploads
  directory must 404, not serve `/etc/passwd`.
- **Ownership** — only the uploader can delete; the file leaves disk with the
  record; the stream then 404s.
- **Cleanup** — the 14-day sweep must count uploads as protected. Regression
  guard: an unplayed upload row survives a real (non-dry-run) cleanup.
- **Rate limit** — upload spam is blocked.

`uploads-ui.test.mjs` drives the browser: filename pre-fills title/artist,
duration is read client-side, the song appears in the Uploads tab, and
double-clicking it actually plays (audio element advances past zero with no
error).

## What `privacy.test.mjs` covers

Two independent switches (Settings → Profile → Privacy): Discord rich
presence, and appearing in "Friends are listening to".

- **Defaults to sharing** — the flags are stored inverted (`hide_*`) so
  existing users don't silently vanish the day this ships.
- **Server-side enforcement** — a hidden user is absent from the
  `/api/listening` *response*, not merely unrendered. A UI-only hide would
  still leak them to anyone reading the network tab.
- **Independence** — turning one off leaves the other alone. A single shared
  flag would be a quiet privacy bug.
- **No resurrection** — a fresh play doesn't bring a hidden user back.
- **Discord** — the server refuses to broadcast for an opted-out user, resumes
  when re-enabled, and treats a session-less caller as opted out.
- **Per-user** — one person hiding doesn't affect anyone else.

The UI itself (both switches render, flipping one persists across a reload and
leaves the other alone) was verified in a headless browser against the same
sandbox.

## What `desktop-update.test.mjs` covers

The desktop auto-update feed (SETUP.md → "Desktop auto-update"). It stands up
a **fake GitHub API**, so it needs no token, no network, and never touches the
real release. Run a third sandbox server for it:

```bash
GITHUB_RELEASES_TOKEN=test-token GITHUB_API_BASE=http://127.0.0.1:4321 \
UPDATE_CACHE_MS=0 npx next start -p 3007 &
```

(`UPDATE_CACHE_MS=0` disables the 5-minute cache that production uses —
otherwise a warm result hides the failure paths.)

- **The right asset per platform** — macOS updates from the `.app.tar.gz`, NOT
  the `.dmg` a human downloads; Windows the NSIS installer; Linux the AppImage.
- **Signature included** — Tauri verifies it against the pubkey compiled into
  the app, so a release with no `.sig` must yield NO update rather than an
  unverifiable one.
- **Downloads route through this server**, never GitHub directly — that's what
  keeps the token on the host and the repo private.
- **204 means up to date**, and every failure degrades to it: GitHub down,
  draft-only releases, same or newer client version, unknown platform. A broken
  update check must never interrupt playback.
- **The asset proxy** streams bytes with the token attached server-side, and
  rejects a non-numeric or unknown asset id.
- **No session needed** — the updater runs in Rust and has no cookies.
