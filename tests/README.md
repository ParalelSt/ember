# Tests

Runnable checks against a **sandbox** copy of the app. Nothing here touches
your live PocketBase data or your real Discord.

> Never point these at the running production stack (`:3000` / `:8090`). The
> whole point of the sandbox is that a test can't damage anything.

## Sandbox setup

From the repo root:

```bash
# 1. Copy the database somewhere disposable
SB=/tmp/ember-sandbox && mkdir -p "$SB" && cp -R pocketbase/pb_data "$SB/pb_data"
cp -R pocketbase/pb_hooks "$SB/pb_hooks"

# 2. PocketBase on a spare port (the ensure_* hooks add any new
#    collections/fields on boot — watch the log for them)
./pocketbase/pocketbase serve --http=127.0.0.1:8091 --dir="$SB/pb_data" \
  --hooksDir="$SB/pb_hooks" &

# 3. Build once (turbopack dev is unreliable here — always test a real build)
cd apps/web && npx next build --webpack

# 4. The app against that sandbox
POCKETBASE_URL=http://127.0.0.1:8091 MUSIC_DIR="$SB/music" \
npx next start -p 3005 &
```

`POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD` come from
`apps/web/.env.local`; the tests default to the values in `.env.example`.

## Running

```bash
node tests/privacy.test.mjs     # or: npm run test:privacy
```

Exit code 0 = everything passed; each check prints PASS/FAIL with detail.

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
