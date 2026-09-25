# Ports

Ember binds two local ports by default:

| Service | Default port | env var |
|---|---|---|
| Next.js (web app) | `3000` | `PORT` |
| PocketBase (db + auth) | `8090` | `POCKETBASE_PORT` |

Only `3000` is ever exposed publicly (via Tailscale Funnel). PocketBase stays on `127.0.0.1` and is reached from the browser through Next's same-origin `/pb/*` rewrite.

---

## Change a port (one file)

Edit `apps/web/.env.local` and uncomment / add the relevant lines:

```
PORT=3001
POCKETBASE_PORT=8091
```

Either or both. `start-static.sh` reads both at boot, passes `--http 127.0.0.1:$POCKETBASE_PORT` to PocketBase, exports `PORT` to Next, and rewrites `POCKETBASE_URL` to match. Restart and you're done:

```bash
lsof -i :8090 -t | xargs kill   # use whatever port PB was on
./start-static.sh
```

If you're using Tailscale Funnel, also re-bind it to the new Next port:

```bash
tailscale funnel reset
tailscale funnel --bg 3001
```

---

## What NOT to change

- The browser-facing path stays `/pb/*` regardless of which PB port you pick. That path is the proxy mount; it doesn't bake in a port.
- Don't bind PocketBase to `0.0.0.0` and expose its port publicly. Keep it on `127.0.0.1`. The browser hits PB through Next's `/pb` proxy on the public Next port — that's the whole point of the rewrite (one public URL covers the whole app).
