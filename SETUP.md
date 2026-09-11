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

### Updating to a new version

```bash
./update.sh            # pull, install if needed, rebuild, restart everything
./update.sh --check    # just show what's new, change nothing
./update.sh --no-start # update the code only (hosts running Ember via systemd)
```

**Don't use `git pull && ./start-static.sh` for this.** start-static.sh skips
PocketBase when it's already healthy, so you'd rebuild the web app while the
old PocketBase keeps running — and Ember creates collections and fields from
`pb_hooks` that only run at PB **boot**. New features would silently do
nothing, with no error explaining why. `update.sh` always restarts PocketBase.

It refuses to run if you have uncommitted changes, and only runs `npm ci` when
`package-lock.json` actually changed.

---

## Project-owner-only setup

These steps are for **you** as the owner of the deployment everyone uses. Friends self-hosting do them for their own copy if they want the same features.

### Bug reports → your Discord channel

There's a "Report a bug" button under `/settings/help`. It POSTs the user's session diagnostics to a Discord webhook.

The webhook URL ships baked into source (you committed it). Friends self-hosting inherit your channel by default. To use a different one for testing, set `DISCORD_BUG_REPORT_WEBHOOK_URL` in `apps/web/.env.local` — the env var wins over the source default.

Server-side error logs live at `logs/errors-YYYY-MM-DD.jsonl` (gitignored, auto-deleted after 2 days). The Discord channel is your long-term archive. If the baked-in webhook ever gets abused, delete + recreate it in Discord and rebuild.

#### What a report contains

- **State when reported**: a snapshot of what the app was doing right then — app version, shell (web/capacitor/tauri), route, the current track and queue position, online/offline, the active playback backend, and (best-effort) storage quota. This is what "Where" summarizes in the Discord embed.
- **Client log**: automatic breadcrumbs (route changes, aria-labelled button/link clicks, console errors/warnings, playback load/play/pause/seek events) plus any explicit `logger.error(...)` calls, for this session and the previous one.
- **Server request log**: the last 5 minutes of server-side request errors and warnings (every API route logs its own outcome — see `withRequestLog`), each tagged with a request id. A client-side "api" error and the server-side entry for that same request share the id, so a report can be traced across the network boundary.
- **Native logs**: on the Android app, native-side failures (download/service errors) are forwarded into the client log as `native:<category>` entries, buffered on the native side until the report reads them so nothing is lost to a slow app start.
- **Desktop log**: on the Tauri app, the shell's own log file (everything outside the WebView — audio engine, media controls, updater) is attached as `desktop.log`, and its tail is included in the AI prompt below.

Privacy is unchanged by any of the above: click breadcrumbs only ever record a button/link's aria-label (never its visible text or the page around it), and the existing scrub/redaction rules for what leaves the device still apply to every field, including the new ones.

#### AI triage (optional)

Set `ANTHROPIC_API_KEY` in `apps/web/.env.local` and every report gets read by
Claude before it lands in Discord. The embed then opens with a one-line summary
of what broke, the likely cause with log evidence, a short hypothesis of how to
reproduce it ("Reproduce"), and up to three things to check first —
colour-coded green/amber/red by severity. Claude sees the "State when
reported" block, the correlated client/server logs above, and the desktop log
tail. The raw `report.json` is still attached, and the reporter sees the same
diagnosis (including the reproduction guess) in the app.

Without the key nothing changes: reports send exactly as they do today. The
same is true if Anthropic is slow, down, or answers with nonsense — triage is
skipped and the report still goes out. It can never eat a bug report.

```bash
ANTHROPIC_API_KEY=sk-ant-…            # from https://console.anthropic.com
BUG_TRIAGE_MODEL=claude-sonnet-5      # optional; claude-haiku-4-5-20251001 is cheaper
```

A report costs well under a cent (the logs are condensed and capped before
they're sent), but **you** pay for everyone's reports since the key is yours.
The 30-second-per-user cooldown on reports caps the spend too.

### Desktop auto-update

The desktop apps check this server on launch and install new builds
themselves. They ask `/api/desktop/update/...`; the server answers from the
GitHub Release and streams the installer back.

Because the repo is private, the server needs a read-only token — and it stays
on the host, never inside the shipped app:

1. github.com/settings/tokens → **Fine-grained tokens** → this repo only →
   Repository permissions → **Contents: Read-only**.
2. Put it in `apps/web/.env.local`:

```bash
GITHUB_RELEASES_TOKEN=github_pat_...
```

3. Restart the app.

Without the token the feed just answers "no update" — the desktop apps keep
working, they simply never self-update. Publishing a new version is only
`git tag v0.3.0 && git push origin v0.3.0`: CI builds every platform and
attaches the installers, and the apps pick it up on their next launch.

Note the update endpoints are reachable without a login (the updater runs in
Rust and has no session). They expose the latest version and a proxied
installer download — no user data — and the download is rate-limited.

### Custom song uploads

Library → **Upload** puts a file from someone's device onto the server. It
becomes searchable and playable for every signed-in member — the point is a
shared library that grows with things YouTube doesn't have (local bands,
demos, rips).

Nothing to configure. Worth knowing:

- Audio lands in `MUSIC_DIR/uploads` (default `my_music/uploads`), so it's
  covered by whatever backs up your music directory. **PocketBase must be
  restarted once** after updating so the `uploads` collection gets created.
- Limits: 50MB per file and 10 uploads per person per hour. Change the size
  with `MAX_UPLOAD_MB` in `apps/web/.env.local`.
- Uploads are validated by their actual bytes, not the browser's claim, and
  stored under a random filename.
- Only the uploader (or an admin) can delete an upload; the 14-day cleanup
  never touches them.

### Lyrics

The in-player **Lyrics** button (mic icon next to Queue) hits Genius directly — no API key needed. `player.py:cmd_lyrics` uses Genius's public search endpoint to find the song page, then scrapes the lyrics from the page HTML. Works out of the box.

For the planned AI fallback (when Genius has nothing) see **[LYRICS_AI.md](LYRICS_AI.md)**.

### Spotify playlist import (one-time, ~2 minutes)

The Library → **Import** button imports public Spotify and YouTube Music
playlists. **YouTube Music works out of the box.** Spotify needs free API keys
on the host:

1. Go to https://developer.spotify.com/dashboard (log in with any Spotify
   account — free is fine) → **Create app**. Name/description: anything
   (e.g. "Ember import"). Redirect URI: put `http://127.0.0.1:3000` (required
   field, never used). Check "Web API".
2. Open the app's **Settings** → copy **Client ID** and **Client secret**.
3. Add both to `apps/web/.env.local`:

```bash
SPOTIFY_CLIENT_ID=paste-client-id-here
SPOTIFY_CLIENT_SECRET=paste-client-secret-here
```

4. Restart the app (`./start-static.sh`).

Until the keys are set, Spotify links show "Spotify import is not set up on
this server yet" — YT Music import still works. Notes: only **public,
user-created** playlists import (Spotify blocks its own editorial/algorithmic
playlists for standard API apps); tracks are matched onto YouTube Music, and
anything unmatched is listed at the end of the import so it can be added by
hand.

### Keep yt-dlp and ytmusicapi updated  ← do this when things break

YouTube changes constantly and both libraries patch within days. A stale copy
causes symptoms that look like app bugs:

- **stale `ytmusicapi`** → radio / "Recommended for you" silently return NOTHING
  (the server log shows `watch_playlist failed ('endpoint')`)
- **stale `yt-dlp`** → 403s, songs refusing to play

```bash
./.venv/bin/pip install -U yt-dlp ytmusicapi
```

Then restart. Worth doing every month or so, and first thing whenever
recommendations go empty or playback starts failing.

Nothing server-side changes for the Android app's offline downloads: the
native app downloads through the same stream route as normal playback, so a
host with stale `yt-dlp` will see individual tracks fail to download (with
the rest of the pin still succeeding), the same as a stale-`yt-dlp` stream
403. Update `yt-dlp` as above and retry the failed tracks from the app's
Settings, Downloads screen.

### Streaming, the local cache, and 403s

**Ember plays songs off the host's disk.** The first time anyone plays a
track it's downloaded to `my_music/` with yt-dlp, then served from there —
and from that point on it never touches YouTube again. Local plays can't 403.

The cost is that a brand-new song takes a few seconds to start while it
downloads. That's the deliberate trade: reliable beats instant, especially for
the native apps.

The alternative is streaming YouTube through live, which starts instantly but
is where 403s come from — googlevideo URLs are signed for the client that
resolved them and expire, and native players (which fetch byte ranges over
several connections) trip over that far more than a browser does. If you want
that behaviour back:

```bash
STREAM_MODE=proxy        # stream live on first play; falls back to downloading on 403
STREAM_CACHE_WARM=0      # turn OFF background caching (saves disk, keeps 403 exposure)
```

> **This breaks the desktop app.** Observed in production: with `proxy` set, the
> web app plays perfectly while the native apps throw 403s constantly, because
> the Rust engine range-requests and reconnects against signed URLs that a
> browser's single progressive fetch never re-fetches. Do not set it if anyone
> uses the desktop or mobile builds.

In proxy mode, a refused stream is re-resolved once, and if that still fails
Ember downloads the track and serves the file instead. A 403 that survives all
of that means YouTube is blocking the host's IP — fix that with cookies (see
the yt-dlp cookie env vars above).

Concurrent requests for the same uncached song share ONE download, so a player
opening several byte-range connections doesn't start several yt-dlp runs. And
if a download fails outright, Ember falls back to streaming live rather than
failing the play.

**If downloads start 403ing, your yt-dlp is almost certainly stale.** YouTube
breaks older versions every few months, and the giveaway is that search and
playback of already-downloaded songs keep working while new songs won't
download. `./update.sh` upgrades yt-dlp on every run; to do it by hand:

```bash
./.venv/bin/pip install -U yt-dlp ytmusicapi
```

Disk: roughly 3-7 MB per song. The cache grows with listening, so pair it with
the weekly cleanup of tracks nobody has played.

### Automatic cleanup of unplayed songs

Once a day the server deletes tracks **nobody has played in 14 days**, along
with their cached audio in `my_music/`. Anything liked, in a playlist, in a
live session, or in someone's recent searches is kept regardless of age, as is
anything played inside the window.

It runs an hour after boot and then daily. To disable, set `CLEANUP_DISABLED=1`
in `apps/web/.env.local`.

To see what it *would* delete without deleting anything (admin account needed):

```bash
curl -X POST http://127.0.0.1:3000/api/admin/cleanup -H 'Content-Type: application/json' -d '{}'
```

Add `-d '{"apply":true}'` to actually run it. The response reports how many
rows and files were removed and how much disk was freed.

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
