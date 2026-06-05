# Ports

Ember binds two local ports by default:

| Service | Default port |
|---|---|
| Next.js (web app) | `3000` |
| PocketBase (db + auth) | `8090` |

Only `3000` is ever exposed publicly (via Tailscale Funnel). PocketBase stays on `127.0.0.1` and is reached from the browser through Next's same-origin `/pb/*` rewrite.

---

## Change the PocketBase port

Pick a new port (e.g. `8091`).

**1. `start-static.sh`** — add `--http` to the serve line:

```bash
./pocketbase serve --http 127.0.0.1:8091
```

**2. `apps/web/.env.local`** — update the URL:

```
POCKETBASE_URL=http://127.0.0.1:8091
```

**3. Restart everything:**

```bash
lsof -i :8090 -t | xargs kill   # use whatever port PB was on
./start-static.sh
```

`apps/web/next.config.ts` and `apps/web/proxy.ts` already read `POCKETBASE_URL` from env, so they pick up the new port automatically. No other code edits needed.

---

## Change the Next.js port

Pick a new port (e.g. `3001`).

**1. `start-static.sh`** — set `PORT` on the `npm start` line:

```bash
PORT=3001 npm start
```

For `npm run dev` it's the same idea: `PORT=3001 npm run dev`.

**2. Tailscale Funnel** (only if you're using it for the public URL):

```bash
tailscale funnel reset
tailscale funnel --bg 3001
```

Nothing else needs editing — Next reads the `PORT` env automatically.

---

## What NOT to change

- The browser-facing path stays `/pb/*` regardless of which PB port you pick. That path is the proxy mount; it doesn't bake in a port.
- Don't bind PocketBase to `0.0.0.0` and expose its port publicly. Keep it on `127.0.0.1`. The browser hits PB through Next's `/pb` proxy on the public Next port — that's the whole point of the rewrite (one public URL covers the whole app).
