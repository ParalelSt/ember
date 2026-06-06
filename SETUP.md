# Ember — Setup

Ember is a self-hosted Spotify-like music app. You run it from your computer; you (and anyone you invite) can use it from any phone or browser.

It's two pieces: **PocketBase** (database + auth, port 8090) and **Next.js** (the app, port 3000). They sit next to each other in one folder.

All commands below are **bash**. macOS / Linux: any terminal works. **Windows:** install **Git for Windows** and use the **Git Bash** terminal it ships with.

---

## Two ways to run it

Pick based on what you want to do *after* setup:

| Goal | Command | Extra setup |
|---|---|---|
| Use it on this computer only | `npm run dev` (after starting PB) | None |
| Permanent phone-accessible URL | `./start-static.sh` | Tailscale Funnel (one-time, free) |

The Friend setup below gets you to localhost first (cheapest path). When you're ready for phone access, jump to **Permanent URL — Tailscale Funnel**.

---

## Friend setup — start here

Get a working app on your computer in ~10 minutes.

### 1. Install the prereqs

One-time downloads:

- **Git** — https://git-scm.com/downloads *(Windows: this gives you Git Bash. Use it for everything below.)*
- **Node.js 20+** — https://nodejs.org/en/download → LTS installer.
- **Python 3.11+** — https://www.python.org/downloads. macOS already has it. **Windows:** tick *"Add Python to PATH"* in the installer.
- **PocketBase v0.22.21** — https://github.com/pocketbase/pocketbase/releases → pick your OS, unzip, drop the executable (`pocketbase` on Mac/Linux, `pocketbase.exe` on Windows) into the repo's `pocketbase/` folder *after* you clone in step 2.

### 2. Clone, install, configure

```bash
git clone https://github.com/ParalelSt/ember.git
cd ember
npm install
cp apps/web/.env.example apps/web/.env.local
```

### 3. Set up the Python venv

Needed for the YouTube source.

```bash
python3 -m venv .venv
./.venv/bin/pip install yt-dlp imageio-ffmpeg ytmusicapi
```

*(Windows: `python -m venv .venv` then `.venv\Scripts\pip install yt-dlp imageio-ffmpeg ytmusicapi`.)*

Drop the **PocketBase** binary from step 1 into the `pocketbase/` folder if you haven't already.

### 4. Nothing to do — the PB super-admin auto-creates

When you run the app in step 5, the `ensure_superuser.pb.js` hook bundled in `pocketbase/pb_hooks/` runs on PB boot and creates the super-admin `admin@ember.com` / `egKa5WNMx3QpuG7` (the values pre-filled in your `.env.local` from `.env.example`). No `/_/` setup needed.

If you'd rather use different credentials, edit BOTH:
- `pocketbase/pb_hooks/ensure_superuser.pb.js` — the `SU_EMAIL` / `SU_PASSWORD` constants at the top.
- `apps/web/.env.local` — the matching `POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD`.

Then restart PB so the hook picks up the new values.

### 5. Start the app

In a **second terminal**, in the repo root:

```bash
npm run dev
```

Wait for `Ready in …s`. Open **http://localhost:3000**.

(If you'd rather have one command, see **Permanent URL — Tailscale Funnel** below — `./start-static.sh` wraps PB + Next together.)

### 6. Get yourself onto the invite list

The app is invite-only. Either:

- **Hosting for yourself:** http://127.0.0.1:8090/_/ → `allowed_emails` collection → **New record** → enter your email → save.
- **A friend is the owner:** send them your email; they'll add it.

### 7. Sign in

Back at http://localhost:3000 → enter your email → set a password → done. Music search, playlists, all of it works.

---

## Permanent URL — Tailscale Funnel

Free, static `https://ember.<your-tailnet>.ts.net` over the public internet. Your computer must stay **on + signed into Tailscale** for the URL to work; visitors just open it.

Once this is set up, you stop using two terminals — `./start-static.sh` boots PocketBase + the production build of the app in one command.

### 1. Install Tailscale

https://tailscale.com/download → install → open the app once → sign in with Google / Microsoft / GitHub / Apple (creates your tailnet).

Confirm the CLI works:

```bash
tailscale --version
```

If "command not found":

- **macOS:** Tailscale menu bar → *Preferences* → **Install CLI**.
- **Windows:** make sure you installed the system installer (not the Store app); restart Git Bash.
- **Linux:** the official install script (`curl -fsSL https://tailscale.com/install.sh | sh`) drops the CLI in.

### 2. Configure Tailscale

At https://login.tailscale.com/admin:

- *DNS* → scroll to **HTTPS Certificates** → click **Enable HTTPS**.
- *Machines* → click this computer → *Edit machine name* → set to **`ember`**.
- Back on the machine row → toggle **Funnel** on.

If there's no Funnel toggle, go to *Access controls* (left sidebar — the ACL as JSON). Add a top-level key `nodeAttrs` just before the file's final `}`:

```jsonc
"nodeAttrs": [
  {"target": ["autogroup:member"], "attr": ["funnel"]},
],
```

If the line before it doesn't already end with a comma, add one. Click **Save**, refresh the Machines page, the toggle appears.

### 3. Open the public tunnel (once — persists across reboots)

```bash
tailscale funnel --bg 3000
```

It prints `https://ember.<your-tailnet>.ts.net` — your permanent URL.

### 4. Run the app with one command

```bash
./start-static.sh
```

This rebuilds the app, starts PB (if not already running), and serves the production bundle. Re-run it whenever you change code.

Stop the tunnel later: `tailscale funnel reset`.

---

## Project-owner-only setup

These steps are for **you** as the owner of the deployment everyone uses. Friends self-hosting do them for their own copy if they want the same features.

### Bug reports → your Discord channel

There's a "Report a bug" button under `/settings/help`. It POSTs the user's session diagnostics to a Discord webhook.

The webhook URL ships baked into source (you committed it). Friends self-hosting inherit your channel by default. To use a different one for testing, set `DISCORD_BUG_REPORT_WEBHOOK_URL` in `apps/web/.env.local` — the env var wins over the source default.

Server-side error logs live at `logs/errors-YYYY-MM-DD.jsonl` (gitignored, auto-deleted after 2 days). The Discord channel is your long-term archive. If the baked-in webhook ever gets abused, delete + recreate it in Discord and rebuild.

### Lyrics

The in-player **Lyrics** button (mic icon next to Queue) fetches from Genius. You need a Genius access token to enable it:

1. https://genius.com/api-clients → **New API Client** → name/website can be anything.
2. Copy the **Client Access Token** at the bottom.
3. Paste it into `apps/web/.env.local`:
   ```
   GENIUS_ACCESS_TOKEN=<your token>
   ```
4. Make sure the venv has `lyricsgenius`:
   ```bash
   ./.venv/bin/pip install lyricsgenius
   ```
5. Restart the app.

Without the token the lyrics button still works — it just shows "no lyrics found" for every track.

For the AI fallback (when Genius has nothing) see **[LYRICS_AI.md](LYRICS_AI.md)**.

### Adding more invitees

http://127.0.0.1:8090/_/ → `allowed_emails` collection → **New record** → enter the email → save. The user can now register at `/auth` on their next visit. No restart, no code change.

### Promoting an admin

http://127.0.0.1:8090/_/ → `users` collection → click the user → toggle `is_admin = true` → save. Next time they sign in, the **Admin** entry appears in their sidebar and `/admin` becomes available.

The admin dashboard lets you view every user and track, delete either, toggle is_admin on others, and read recent server errors. Standard CRUD is in PB's admin UI at `/_/`.

**Hardcoded owner account.** The hook at `pocketbase/pb_hooks/ensure_admin.pb.js` pre-creates a user record with a hardcoded email + password and `is_admin = true` on every fresh PB boot — so the project owner can sign into any self-hosted deployment without anyone setting them up. The credentials at the top of the file are the project owner's; friends self-hosting can edit them to swap in their own email + password. Treat the password like a real secret — anyone with this file *and* a deployment URL can sign in as admin.

---

## Reset the database (wipes all users + data)

```bash
rm -rf pocketbase/pb_data
cd pocketbase && ./pocketbase serve
```

After the restart, you'll need to recreate the PB admin account at `/_/` again and re-paste the creds into `.env.local`.

---

## Troubleshooting

**Songs won't play / `502` on `/api/youtube/stream/...`** — yt-dlp is probably stale. YouTube changes their signature scrambler every couple weeks and yt-dlp ships daily fixes. Update + restart:

```bash
./.venv/bin/pip install -U yt-dlp
```

Then `Ctrl+C` whatever's running and start it again. `./.venv/bin/yt-dlp --version` should show today's date-ish.

**`./.venv/bin/python: command not found`** — you skipped the venv step. Go back to **Friend setup → 3**.

**`/auth` shows "PocketBase admin credentials not configured"** — you didn't paste `POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD` into `apps/web/.env.local`. Re-do **Friend setup → 4**. The invite-only check needs them to read the `allowed_emails` collection.

**"Bug reporting not configured" 503 when clicking Report a bug** — the Discord webhook isn't set. Owner: paste your webhook URL into the `DEFAULT_WEBHOOK_URL` constant at the top of `apps/web/app/api/bug-report/route.ts`. Anyone else: set `DISCORD_BUG_REPORT_WEBHOOK_URL` in `apps/web/.env.local`.

**Friends can't reach your Tailscale Funnel URL after switching wifi** — Tailscale Funnel binding can get stale when your network changes. On the hosting machine:

```bash
tailscale funnel reset
tailscale funnel --bg 3000
```

If still nothing, try the phone on mobile data instead of wifi — some restrictive wifi networks block `*.ts.net`.
