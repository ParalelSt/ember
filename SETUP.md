# Ember — Setup

Ember is a self-hosted Spotify-like music app. You run it from your computer; you (and anyone you invite) can use it from any phone or browser.

It's two pieces: **PocketBase** (database + auth, port 8090) and **Next.js** (the app, port 3000). They sit next to each other in one folder.

All commands below are **bash**. macOS / Linux: any terminal works. **Windows:** install **Git for Windows** and use the **Git Bash** terminal it ships with.

---

## Friend setup — start here

Get yourself a working local app in ~10 minutes. Follow the steps in order, top to bottom.

### 1. Install the prereqs

One-time downloads:

- **Git** — https://git-scm.com/downloads *(Windows: this gives you Git Bash. Use it for everything below.)*
- **Node.js 20+** — https://nodejs.org/en/download → LTS installer.
- **Python 3.11+** — https://www.python.org/downloads. macOS already has it. **Windows:** tick *"Add Python to PATH"* in the installer.
- **PocketBase binary** — https://github.com/pocketbase/pocketbase/releases → use **v0.22.21**. Pick your OS, unzip, and drop the executable (`pocketbase` on Mac/Linux, `pocketbase.exe` on Windows) into the repo's `pocketbase/` folder once you've cloned it. The binary is gitignored on purpose.

### 2. Clone and install

```bash
git clone https://github.com/ParalelSt/ember.git
cd ember
npm install
cp apps/web/.env.example apps/web/.env.local
```

### 3. Set up the Python venv

This is needed for the YouTube source (yt-dlp under the hood).

```bash
python3 -m venv .venv
./.venv/bin/pip install yt-dlp imageio-ffmpeg ytmusicapi
```

*(Windows: `python -m venv .venv` then `.venv\Scripts\pip install yt-dlp imageio-ffmpeg ytmusicapi`.)*

You can confirm it worked: `./.venv/bin/yt-dlp --version` should print today's date-ish version.

### 4. Start PocketBase (terminal 1)

```bash
cd pocketbase
./pocketbase serve
```

Leave this running. You should see "Server started at http://0.0.0.0:8090".

### 5. Create the PocketBase admin and paste the creds

Open **http://127.0.0.1:8090/_/** in a browser. Fill in an email + password — anything, no need to be your real email. Save it.

Paste those same credentials into `apps/web/.env.local`:

```
POCKETBASE_ADMIN_EMAIL=<the email you just used>
POCKETBASE_ADMIN_PASSWORD=<the password you just used>
```

This is what the app uses to check the invite list when someone tries to register.

### 6. Start the app (terminal 2, in the repo root)

```bash
npm run dev
```

Wait for `Ready in …s`. Open **http://localhost:3000** in a browser.

### 7. Get yourself onto the invite list

If you're hosting **for yourself**, add your email to the allow-list:

- http://127.0.0.1:8090/_/ → `allowed_emails` collection → **New record** → enter your email → save.

If a **friend is the owner**, send them your email — they'll add it to their list.

### 8. Sign in

Back at http://localhost:3000 → enter your email → set a password → you're in.

That's it. Music search, playlists, all of it works.

---

## Want it on your phone? Host it permanently — Tailscale Funnel

Free, static `https://ember.<your-tailnet>.ts.net` URL over the public internet. Your computer must stay **on + signed into Tailscale** for the URL to work; visitors just open it.

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

### 4. Run the production build

```bash
./start-static.sh
```

This rebuilds the app, starts PocketBase (if not already running), and serves the production bundle. Re-run it whenever you change code.

Stop the tunnel later: `tailscale funnel reset`.

---

## Just want to test it on your phone for an afternoon? (no Tailscale)

```bash
./start.sh
```

Prints an ephemeral `*.trycloudflare.com` URL. Open it on your phone. `Ctrl+C` stops everything. The URL changes every restart, so this is for quick tests, not long-term hosting.

Needs `cloudflared` in `pocketbase/`: https://github.com/cloudflare/cloudflared/releases.

---

## Project-owner-only setup

These steps are for **you** as the owner of the deployment everyone uses. Friends self-hosting do these for their own copy if they want the same features.

### Bug reports → your Discord channel

There's a "Report a bug" button under `/settings/help`. It POSTs the user's session diagnostics to a Discord webhook.

The webhook URL ships baked into source (you committed it). Friends self-hosting inherit your channel by default. To use a different one for testing, set `DISCORD_BUG_REPORT_WEBHOOK_URL` in `apps/web/.env.local` — the env var wins over the source default.

Server-side error logs live at `logs/errors-YYYY-MM-DD.jsonl` (gitignored, auto-deleted after 2 days). The Discord channel is your long-term archive. If the baked-in webhook ever gets abused, delete + recreate it in Discord and rebuild.

### Adding more invitees

http://127.0.0.1:8090/_/ → `allowed_emails` collection → **New record** → enter the email → save. The user can now register at `/auth` on their next visit. No restart, no code change.

### Promoting an admin

http://127.0.0.1:8090/_/ → `users` collection → click the user → toggle `is_admin = true` → save. Next time they sign in, the **Admin** entry appears in their sidebar and the `/admin` dashboard becomes available.

The admin dashboard lets you view every user and track, delete either, toggle is_admin on others, and read recent server errors. Use it for ops + cleanup. Standard CRUD is in PB's admin UI at `/_/`.

---

## Reset the database (wipes all users + data)

```bash
rm -rf pocketbase/pb_data
cd pocketbase && ./pocketbase serve
```

After the restart, you'll need to recreate the PB admin account at `/_/` again.

---

## Troubleshooting

**Songs won't play / `502` on `/api/youtube/stream/...`** — yt-dlp is probably stale. YouTube changes their signature scrambler every couple weeks and yt-dlp ships daily fixes. Update + restart:

```bash
./.venv/bin/pip install -U yt-dlp
```

Then `Ctrl+C` whatever's running (`start-static.sh` / `start.sh` / `npm run dev`) and start it again. `./.venv/bin/yt-dlp --version` should show today's date-ish.

**`./.venv/bin/python: command not found`** — you skipped the venv step. Go back to **Friend setup → 3**.

**"Bug reporting not configured" 503 when clicking Report a bug** — you didn't set `POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD` in `apps/web/.env.local`. Re-do **Friend setup → 5**.

**Friends can't reach your Tailscale Funnel URL after switching wifi** — Tailscale Funnel binding can get stale when your network changes. On the hosting machine:

```bash
tailscale funnel reset
tailscale funnel --bg 3000
```

If still nothing, try the phone on mobile data instead of wifi — some restrictive wifi networks block `*.ts.net`.
