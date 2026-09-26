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
./.venv/bin/pip install -r requirements.txt
./.venv/bin/python ffmpeg_path.py   # prints Ember's own ffmpeg
```

*(Windows: `python -m venv .venv` then `.venv\Scripts\pip install -r requirements.txt`.)*

**No ffmpeg install needed.** `imageio-ffmpeg` (in `requirements.txt`) ships a
static ffmpeg binary; `player.py` (yt-dlp) and `transcribe.py` (tab
generation) find it through `ffmpeg_path.py`, and every `./update.sh` installs
the package if missing and links the binary to `.venv/bin/ffmpeg`. A system
ffmpeg on `PATH` is only the fallback. If something says "ffmpeg is missing:
run ./update.sh", that is the fix.

Drop the **PocketBase** binary from step 1 into the `pocketbase/` folder if you haven't already.

### 4. Choose the PocketBase superuser password

PocketBase has a superuser (the `/_/` admin UI login), and the web server signs in as it to read the invite list. Set its password in `apps/web/.env.local`:

```bash
POCKETBASE_ADMIN_EMAIL=admin@ember.com
POCKETBASE_ADMIN_PASSWORD=<a long random password>
```

Make one with `openssl rand -base64 24 | tr -d '/+='` (letters and digits only: quotes and `#` confuse the env file). Never use a password that has ever been in this repo; the repo is public.

`./start-static.sh` passes these two values to PocketBase as `EMBER_PB_SUPERUSER_EMAIL` / `EMBER_PB_SUPERUSER_PASSWORD`, and the `ensure_superuser.pb.js` hook then creates the superuser, or changes its password to match, on every PocketBase boot. So `.env.local` is the one place to set or change it: edit, restart, done. If you start PocketBase by hand (with `npm run dev`), pass them yourself:

```bash
cd pocketbase
EMBER_PB_SUPERUSER_EMAIL=admin@ember.com EMBER_PB_SUPERUSER_PASSWORD='<same password>' ./pocketbase serve
```

Without them, the hook changes nothing and only logs a warning: an existing superuser keeps its password, so a missing variable can never lock you out.

**Optional, the owner account.** Add `EMBER_ADMIN_EMAIL` / `EMBER_ADMIN_PASSWORD` to `.env.local` and the `ensure_admin.pb.js` hook creates that app account with `is_admin = true` on a fresh database. It is only a first password: once the account exists the hook never touches it again, so change it in the app afterwards.

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

Every run also installs Ember's own ffmpeg (`imageio-ffmpeg`) if it is missing
and relinks it to `.venv/bin/ffmpeg`, so the host never needs a system ffmpeg.

**Don't use `git pull && ./start-static.sh` for this.** start-static.sh skips
PocketBase when it's already healthy, so you'd rebuild the web app while the
old PocketBase keeps running — and Ember creates collections and fields from
`pb_hooks` that only run at PB **boot**. New features would silently do
nothing, with no error explaining why. `update.sh` always restarts PocketBase.

It refuses to run if you have uncommitted changes, and only runs `npm ci` when
`package-lock.json` actually changed.

### Crash logging

`./start-static.sh` stays in the foreground as a **watchdog** over PocketBase
and the web app. If either one exits without being asked to (a crash, an out
of memory kill, a `kill -9`), the watchdog restarts it after 5 s, then 30 s,
then 120 s for every further crash. A service that crashes 5 times within 10
minutes gets a "giving up" report and is then retried quietly every 10
minutes, with no further posts, until it stays up; that recovery is posted
once. The other service keeps running the whole time.

**Run it inside tmux**, so closing PuTTY does not stop it. A closed SSH window
sends the watchdog SIGHUP, and it stops Ember cleanly and reports that it did.
`nohup` is not a substitute: the login shell's hangup still reaches the web
app. `lsof` must be installed (`sudo apt install lsof`); `update.sh` uses it
to find what to stop, and both scripts refuse to run without it.

```bash
tmux new -s ember        # start a session, then run ./start-static.sh in it
                         # detach and leave it running: Ctrl+B, then D
tmux attach -t ember     # come back to it later (after reconnecting over SSH)
```

**What gets posted to Discord** (one embed each, footer with the host name,
git commit and time, no @mentions):

- **A crash**: which service, how it exited (exit code, or the signal that
  killed it), and when it restarts, with the last 50 lines of its log attached.
- **Giving up** on a service after 5 crashes in 10 minutes, with its log tail.
- **Back up**: a service the watchdog gave up on stayed up again ("Next is
  back up after 3 attempts").
- **A server error** inside the web app that nothing else caught (an uncaught
  exception or an unhandled promise rejection): the message as the title, the
  stack as the text, once per distinct message per server process. The server
  keeps running after either, as Next does on its own: exiting would turn one
  error that repeats on some page into a restart loop and a give-up (see
  `apps/web/lib/crashHandlers.ts`).
- **Terminal closed**: the SSH session ended and took Ember with it.
- **Unclean shutdown**: Ember started while `logs/ember.lock` from a previous
  run was still there with its process gone, meaning the machine rebooted,
  lost power, or the watchdog was killed outright.

Planned stops are never reported: Ctrl+C, `kill <watchdog pid>` (SIGTERM),
systemd stopping it, and `./update.sh` (which stops the watchdog first, then
anything still on the ports, and does so before an `npm ci` so the install
cannot pull the web app's dependencies out from under it).

Log tails are scrubbed of bearer tokens, cookies, `pb_auth`, query-string
values and long hex/base64 blobs before they are sent. At most 10 reports go
out per hour; past that, one "too many crash reports, muted for this hour"
message and then silence until the hour is up.

**Where the posts go**: `DISCORD_CRASH_WEBHOOK_URL` if set, else
`DISCORD_BUG_REPORT_WEBHOOK_URL`, looked up in the environment and then in
`apps/web/.env.local`; with neither, the bug-report channel's built-in webhook
(read from `app/api/bug-report/route.ts`). To get crashes in their own channel,
add `DISCORD_CRASH_WEBHOOK_URL=...` to `apps/web/.env.local`.

**Log files** in `logs/` (gitignored):

| File | What |
| --- | --- |
| `next.log`, `pocketbase.log` | Each service's output (also shown in the terminal). Rotated to `.1` at 5 MB, checked at every start and restart. |
| `watchdog.log` | Starts, stops, crashes, restarts, give-ups, the quiet retries, recoveries, and any Discord posting error. |
| `errors-YYYY-MM-DD.jsonl` | The web app's own server error log (uncaught errors land here too). |
| `watchdog.pid` | The running watchdog's pid, used by `update.sh`. Removed on a clean stop. |
| `ember.lock` | pid and start time of the running watchdog. Left behind only by an unclean shutdown. |
| `crash-report.state` | The hourly post count for the rate limit. |

Starting a second copy while one is running refuses with the running pid.

---

## Project-owner-only setup

These steps are for **you** as the owner of the deployment everyone uses. Friends self-hosting do them for their own copy if they want the same features.

### Bug reports → your Discord channel

There's a "Report a bug" button under `/settings/help`. It POSTs the user's session diagnostics to a Discord webhook.

The webhook URL ships baked into source (you committed it). Friends self-hosting inherit your channel by default. To use a different one for testing, set `DISCORD_BUG_REPORT_WEBHOOK_URL` in `apps/web/.env.local` — the env var wins over the source default.

Server-side error logs live at `logs/errors-YYYY-MM-DD.jsonl` (gitignored, auto-deleted after 2 days). The Discord channel is your long-term archive. If the baked-in webhook ever gets abused, delete + recreate it in Discord and rebuild.

#### What a report contains

- **State when reported**: a snapshot of what the app was doing right then: app version, shell (web/capacitor/tauri), route, the current track and queue position, online/offline, the active playback backend, and (best-effort) storage quota. This is what "Where" summarizes in the Discord embed.
- **Client log**: automatic breadcrumbs (route changes, aria-labelled button/link clicks, console errors/warnings, playback load/play/pause/seek events) plus any explicit `logger.error(...)` calls, for this session and the previous one.
- **Server request log**: the last 5 minutes of server-side request errors and warnings (every API route logs its own outcome: see `withRequestLog`), each tagged with a request id. A client-side "api" error and the server-side entry for that same request share the id, so a report can be traced across the network boundary.
- **Native logs**: on the Android app, native-side failures (download/service errors) are forwarded into the client log as `native:<category>` entries, buffered on the native side until the report reads them so nothing is lost to a slow app start.
- **Desktop log**: on the Tauri app, the shell's own log file (everything outside the WebView: audio engine, media controls, updater) is attached as `desktop.log`, and its tail is included in the AI prompt below.

Privacy is unchanged by any of the above: click breadcrumbs only ever record a button/link's aria-label (never its visible text or the page around it). What's scrubbed, precisely:

- The **client snapshot** (breadcrumbs, errors, "State when reported") is run through `lib/logger/sanitize.ts`'s `scrub()` on the device before it's sent: known-sensitive field names (password, token, cookie, authorization) are redacted, long strings are truncated.
- **Native log** entries forwarded from the Android app go through the same client snapshot, so the same rules apply to them.
- The **desktop log tail** (Tauri) is free text from outside the WebView, so it's scrubbed differently: `scrubText()` runs each line through pattern matches for bearer tokens, cookie headers, `pb_auth` assignments, query-string values, and long hex/base64 blobs, right after it's read in `BugReportDialog.tsx`, before it's ever sent.
- The **server request log window** attached to a report is also free text/data from disk, not the client's already-scrubbed snapshot: the route runs each entry's `message`, `data`, and `stack` through the same `scrubText()` before attaching it or handing it to triage. The one field left alone is `userId`: it's a PocketBase id the host's own instance already issued, not a secret, and it's useful for tracing a report back to an account.

#### AI triage (optional)

Set `ANTHROPIC_API_KEY` in `apps/web/.env.local` and every report gets read by
Claude before it lands in Discord. The embed then opens with a one-line summary
of what broke, the likely cause with log evidence, a short hypothesis of how to
reproduce it ("Reproduce"), and up to three things to check first,
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

#### Automatic reports

Signed-in users also get a "Send crash reports automatically" toggle in
`/settings/help` (on by default). When the client logger records an
error-level entry (an uncaught error, an unhandled promise rejection, a
backend playback failure, or a native offline error), `lib/autoReport.ts`
silently posts the same body the bug report dialog would, tagged
`automatic: true`, with the note filled in as `<category>: <message>`. It's
deduped per error fingerprint per browser session, capped at three reports a
session, debounced 2 seconds so a burst of the same error only sends once,
and it never fires while the manual dialog is open or while the toggle is
off.

The server rate-limits these separately from manual reports (3/hour per user,
independent of the 30s manual cooldown) and triages them with a cheaper
model by default, since they can fire without anyone deciding a report was
worth it:

```bash
BUG_TRIAGE_MODEL_AUTO=claude-haiku-4-5-20251001   # optional override
```

The Discord embed titles these "Automatic report from `<email>`" and adds an
"automatic" marker to the footer, so a maintainer can tell them apart from a
report someone chose to send.

#### Daily error digest

Once a day the server posts a digest of its own error log to the same Discord
channel: every server-side error and warning of the last 24 hours, grouped by
fingerprint, so a hundred occurrences of one bug read as one line rather than
a hundred. With `ANTHROPIC_API_KEY` set, the cheaper model
(`BUG_TRIAGE_MODEL_AUTO`) adds a headline and a few lines of what is worth
looking at; without it the digest still posts the grouped lines and says so in
the footer. The full grouping is attached as `digest.json`.

Off until you turn it on, because reports and the digest share one webhook and
a self-hosted copy would otherwise post into the channel baked into the app.
Set the switch on the machine that should send it:

```bash
DIGEST_ENABLED=1     # required; without it the scheduled digest never runs
DIGEST_HOUR=8        # optional; hour of the local day to send, 0-23
```

The day's send is recorded as `logs/digest-YYYY-MM-DD.sent`, so restarting the
server does not repost, and a host that was off at `DIGEST_HOUR` still sends
the digest when it comes back up. Delete that file to let the schedule send
again today.

To send one right now (admins only, and only once `DIGEST_ENABLED=1` is set;
otherwise the endpoint answers 503), POST to the manual trigger. It always
covers the last 24 hours, ignores the day's marker and writes no marker, so
it can be run as often as you like:

```bash
curl -X POST http://localhost:3000/api/admin/digest \
  -H "cookie: pb_auth=$YOUR_PB_AUTH_COOKIE"
```

It answers `{"posted": true, "groups": [...]}`, or `{"posted": false,
"reason": "quiet"}` on a day with no errors at all.

### Feature and fix requests → your Discord channels

There's a "Send a request" button next to Report a bug under `/settings/help`.
Like bug reports, the two channel webhooks ship in source
(`DEFAULT_WEBHOOKS` in `apps/web/app/api/requests/route.ts`), so friends
self-hosting send to your channels too. To send somewhere else, set
`DISCORD_FEATURE_WEBHOOK_URL` and `DISCORD_FIX_WEBHOOK_URL` in
`apps/web/.env.local`; the env vars win.

### Desktop auto-update

The desktop apps check this server on launch and install new builds
themselves. They ask `/api/desktop/update/...`; the server answers from the
GitHub Release and streams the installer back. That download route
(`/api/desktop/asset/<id>`) is public, so it only serves the latest published
release's update files (the macOS `.app.tar.gz`, the Windows `-setup.exe`,
the Linux `.AppImage`, their `.sig`, `latest.json`); any other asset of the
repo is a 404 and GitHub is never asked for it.

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

### Spotify playlist import (no setup)

The Library **Import** button imports public Spotify and YouTube Music
playlists. **Both work out of the box: no keys, no developer account, nothing
in `.env.local`.**

- **Spotify**: Ember reads the playlist from Spotify's public embed page
  (`open.spotify.com/embed/playlist/<id>`, the player websites use to show a
  playlist) and takes the name and cover from Spotify's oEmbed endpoint. Any
  public playlist works, Spotify's own editorial playlists included. Spotify
  only lists the **first 100 songs** there, so a longer playlist stops at 100
  (the dialog says so). Private playlists and Liked Songs cannot be read this
  way; connecting a Spotify account for those is a later, optional stage.
- **YouTube Music and YouTube**: public and unlisted playlists, read with
  ytmusicapi, with `yt-dlp --flat-playlist` as the fallback.

Each Spotify song is matched on YouTube Music and scored (title, artist,
length, explicit flag, live/remix/cover versions, official audio vs fan
uploads). Only confident matches are added; the rest are listed at the end of
the import as "Needs review" or "Not found" so they can be added by hand.

**Why the old setup steps are gone:** this section used to ask for a
`SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` from a developer.spotify.com
app. Spotify's February 2026 Web API change means such an app can no longer
read the songs of a playlist it does not own, so those keys stopped working
for import and Ember no longer uses them. If your `apps/web/.env.local` still
has them, delete both lines.

If Spotify imports start failing with "Spotify changed its playlist page",
Spotify has changed the embed page's shape: file a bug report. The parser is
`apps/web/lib/import/embed.ts`, tested against a saved page in
`tests/fixtures/imports/`.

### Generated guitar tabs (optional)

The tabs button in the player can write a guitar tab from the song's own
recording. It needs extra Python packages in `.venv`; without them the tab
page greys out "Generate a tab" and says the server needs the optional tab
tools, and everything else keeps working. To see what this host lacks:

```bash
.venv/bin/python transcribe.py --check    # {"ok": false, "missing": ["basic_pitch", ...]}
```

The app asks the same thing through `GET /api/tabs/tools` (kept for five
minutes, so installing takes effect without a restart). To install:

```bash
.venv/bin/pip install 'setuptools<80'
.venv/bin/pip install --no-deps basic-pitch
.venv/bin/pip install onnxruntime librosa pretty_midi 'resampy<0.4.3' mir_eval scikit-learn typing-extensions
# Optional but recommended: separates the guitar from the mix first. ~2GB.
.venv/bin/pip install demucs
```

The first generation with Demucs downloads its model (~80MB). A four-minute
song takes a few minutes of CPU with Demucs, seconds without; jobs run one
at a time and the result is kept in `my_music/tabs/generated/`, so each
song is only transcribed once. Delete a file there to regenerate it.

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

**At most two downloads at once.** However many listeners hit uncached songs,
the host runs no more than two yt-dlp processes; the rest wait their turn. The
apps also save the next couple of songs ahead of time (so a dropped connection
does not stop the music), and those requests are low priority: they only
start a download when the host is idle, and each listener gets 10 a minute.
Details in `docs/prefetch.md`.

Searches, album and artist pages and other lookups have their own slots, so
a slow download never makes a search wait, and import batches have theirs.
When every slot is taken for too long (15 s for a search, 60 s for a
download), the caller gets a "busy, try again" answer instead of piling up.

```bash
MAX_CONCURRENT_DOWNLOADS=2   # yt-dlp processes at once (default 2)
PYTHON_MAX_CONCURRENCY=4     # searches and page lookups at once (default 4)
PYTHON_MAX_BULK=2            # import batches at once (default 2)
```

**Only members fetch new songs.** A song already on the host plays for anyone
(a shared `/track` link works for a friend who is not signed in), but getting
one the host does not have yet, which runs yt-dlp with the host's YouTube
cookies, takes a signed-in account. Each member can start 60 new downloads a
minute and 600 an hour. Videos longer than 20 minutes (or bigger than 60 MB,
or live streams) are refused with "too long to play", and never streamed live
instead. Raise the caps if your library has long mixes:

```bash
EMBER_MAX_TRACK_MINUTES=20   # longest video the host fetches (default 20)
EMBER_MAX_DOWNLOAD_MB=60     # biggest audio file it downloads (default 60)
```

Songs already on disk are never affected by these caps.

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

### Trending chart country

Home's "Trending right now" shelf is a blend of several countries' YouTube
Music daily charts, fetched a few times a day and cached in
`my_music/trending.json`. By default it blends the US, UK, German and
Serbian charts (a worldwide chart leans heavily toward whichever country has
the most listeners, which does not suit every group of friends). To change
the mix, set a comma list of two-letter codes in `apps/web/.env.local` and
restart:

```bash
TRENDING_COUNTRIES=US,GB,DE,RS   # default; a comma list of chart country codes
```

Unknown codes are dropped with a log warning; if none are left, the default
blend is used. Only countries YouTube Music has charts for work (Germany,
Austria, Hungary, Italy, Czechia and Serbia do; Croatia does not). The
setting is per server, so everyone on it sees the same blended chart.

To show a single country's chart instead of a blend, set `TRENDING_COUNTRY`
(unchanged from before, and it wins over `TRENDING_COUNTRIES` when set):

```bash
TRENDING_COUNTRY=DE      # a single chart country code; overrides TRENDING_COUNTRIES
```

An unknown code falls back to the global chart (`ZZ`).

### Adding more invitees

http://127.0.0.1:8090/_/ → `allowed_emails` collection → **New record** → enter the email → save. The user can now register at `/auth` on their next visit. No restart, no code change.

### Promoting an admin

http://127.0.0.1:8090/_/ → `users` collection → click the user → toggle `is_admin = true` → save. Next time they sign in, the **Admin** entry appears in their sidebar and `/admin` becomes available.

The admin dashboard lets you view every user and track, delete either, toggle is_admin on others, and read recent server errors. Standard CRUD is in PB's admin UI at `/_/`.

**Owner account.** `pocketbase/pb_hooks/ensure_admin.pb.js` creates the owner's account with `is_admin = true` when `EMBER_ADMIN_EMAIL` / `EMBER_ADMIN_PASSWORD` are set and the account doesn't exist yet (see **Friend setup, step 4**). It never changes an existing account's password. Nothing is hardcoded: the repo is public.

---

## Reset the database (wipes all users + data)

```bash
rm -rf pocketbase/pb_data
./start-static.sh
```

The superuser comes back from `POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD` in `.env.local` (and the owner account from `EMBER_ADMIN_*`, if set). Starting PocketBase by hand instead, pass them as shown in **Friend setup, step 4**.

---

## Troubleshooting

**Songs won't play / `502` on `/api/youtube/stream/...`** — yt-dlp is probably stale. YouTube changes their signature scrambler every couple weeks and yt-dlp ships daily fixes. Update + restart:

```bash
./.venv/bin/pip install -U yt-dlp
```

Then `Ctrl+C` whatever's running and start it again. `./.venv/bin/yt-dlp --version` should show today's date-ish.

**`./.venv/bin/python: command not found`** — you skipped the venv step. Go back to **Friend setup → 3**.

**`/auth` shows "PocketBase admin credentials not configured"** — you didn't paste `POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD` into `apps/web/.env.local`. Re-do **Friend setup → 4**. The invite-only check needs them to read the `allowed_emails` collection.

**`/auth` shows "Failed to authenticate as PB admin":** PocketBase's superuser password doesn't match `POCKETBASE_ADMIN_PASSWORD`. Restart with `./start-static.sh` (or `./update.sh`): that restarts PocketBase with the password from `.env.local`, and its hook brings the superuser in line. `logs/pocketbase.log` says what it did (`[ensure_superuser] ...`).

**The PocketBase admin UI (`/_/`) says 404 on the public URL:** that is on purpose. The app's `/pb` proxy never forwards the admin UI or the superuser API to the internet. Open it on the host itself: `http://127.0.0.1:8090/_/`, or from your own computer through an SSH tunnel (`ssh -L 8090:127.0.0.1:8090 you@host`, then http://127.0.0.1:8090/_/).

**"Bug reporting not configured" 503 when clicking Report a bug** — the Discord webhook isn't set. Owner: paste your webhook URL into the `DEFAULT_WEBHOOK_URL` constant at the top of `apps/web/app/api/bug-report/route.ts`. Anyone else: set `DISCORD_BUG_REPORT_WEBHOOK_URL` in `apps/web/.env.local`.

**Friends can't reach your Tailscale Funnel URL after switching wifi** — Tailscale Funnel binding can get stale when your network changes. On the hosting machine:

```bash
tailscale funnel reset
tailscale funnel --bg 3000
```

If still nothing, try the phone on mobile data instead of wifi — some restrictive wifi networks block `*.ts.net`.
