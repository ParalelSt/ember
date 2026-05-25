# PocketBase setup

This app uses [PocketBase](https://pocketbase.io) as the backend (auth + DB + realtime + file storage). PocketBase is a single Go binary that runs on Mac/Linux/Windows with no Docker, no Postgres install, no external service.

## Architecture

- **`pocketbase/pocketbase`** — the server binary (gitignored, per-platform).
- **`pocketbase/pb_migrations/`** — collection schema as JS migrations (committed). Applied automatically on `./pocketbase serve` startup.
- **`pocketbase/pb_data/`** — SQLite database + uploads (gitignored, per-host).
- **Web app** in `apps/web/` connects via the PocketBase JS SDK. Default URL: `http://127.0.0.1:8090`.

## Collections (created by `1748150000_init_schema.js`)

| Collection         | Purpose                                | Owner field |
| ------------------ | -------------------------------------- | ----------- |
| `users` (built-in) | Auth — email/password by default       | —           |
| `tracks`           | Shared catalog of cached track metadata | none (any authed user can upsert) |
| `playlists`        | User-owned named lists                 | `user` |
| `playlist_tracks`  | Junction: which tracks in which playlist + position | via `playlist.user` |
| `likes`            | User/track favorites                   | `user` |
| `plays`            | Listening history                      | `user` |

Tracks use `external_id` (e.g. `"yt_dQw4w9WgXcQ"`) as the app-facing ID with a unique index. PocketBase's auto-generated record ID is what relations point at internally.

## Running locally (developer)

```bash
cd pocketbase
./pocketbase serve
```

First run prompts you to create an admin account at http://127.0.0.1:8090/_/. Pick anything — admin only manages the backend, app users sign up separately.

The web app expects:

```bash
# apps/web/.env.local
NEXT_PUBLIC_POCKETBASE_URL=http://127.0.0.1:8090
```

Start both servers:

```bash
# Terminal 1
cd pocketbase && ./pocketbase serve

# Terminal 2
npm run dev
```

## Self-hosting (your friend runs it on his PC)

1. **Download the binary** for his platform from [pocketbase.io/docs](https://pocketbase.io/docs/) (one file).
2. **Drop it in** `spotify-clone/pocketbase/pocketbase` (or `pocketbase.exe` on Windows).
3. **Start it**:
   ```bash
   cd pocketbase
   ./pocketbase serve --http=0.0.0.0:8090
   ```
   `--http=0.0.0.0` makes it reachable from other devices on the LAN; default `127.0.0.1` is localhost-only.
4. **Create admin** at `http://<his-ip>:8090/_/` on first start.
5. **Migrations run automatically** — collections appear on first boot.

### Web app pointing at his backend

If he hosts at `http://192.168.1.50:8090`, set the same value in his `.env.local`:

```bash
NEXT_PUBLIC_POCKETBASE_URL=http://192.168.1.50:8090
```

Or — if he runs both the web app AND PocketBase on the same machine — leave it as `127.0.0.1:8090` and reach the web app at `http://<his-ip>:3000`.

### Production-ish hardening (optional, only if exposing to the internet)

- Run behind a reverse proxy (Caddy, nginx) with HTTPS.
- Set strong admin password.
- Restrict admin UI by IP if possible.
- Back up `pb_data/data.db` regularly — it's a single SQLite file.

## Re-applying schema after edits

PocketBase auto-applies new migration files in `pb_migrations/` on every `./pocketbase serve`. To roll back the last one:

```bash
./pocketbase migrate down 1
```

To create a new migration template:

```bash
./pocketbase migrate create some_name
```

To snapshot the current admin-UI state to a migration:

```bash
./pocketbase migrate collections
```

## Wiping the database (reset to fresh)

```bash
rm -rf pocketbase/pb_data
cd pocketbase && ./pocketbase serve
# admin signup again, all collections re-created from migrations
```
