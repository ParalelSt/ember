# 0.3.7: Radio works for every song

**Host: a normal rebuild and restart (`./update.sh`). Nothing to configure.**

- **Recommendations (radio) work for every song**: a small slice of
  YouTube ids legitimately start with a dash, and those seeds were
  crashing the recommendation lookup with a 502; fixed at the call site so
  it can't recur.

# 0.3.6: Trending fits better

**Host: a normal rebuild and restart (`./update.sh`). No `npm install`, no
required environment variable change.** Optional: set `TRENDING_COUNTRIES`
in `apps/web/.env.local` to pick your own mix of chart countries (a comma
list of two-letter codes, default `US,GB,DE,RS`); `TRENDING_COUNTRY`
(single code) still works and overrides it, for hosts who already set it.

- **The Trending shelf now blends charts**: instead of YouTube Music's
  worldwide chart, which leans heavily toward whichever country has the
  most listeners, Home's "Trending right now" shelf now mixes the US, UK,
  German and Serbian daily charts.

# 0.3.5: Spotify imports work again

**Host: a normal rebuild and restart (`./update.sh`), and restart
PocketBase once: on boot it creates two new collections, `import_jobs` and
`import_items`, and adds `source_url` and `import_job` to `playlists`
(`pocketbase/pb_hooks/ensure_imports.pb.js`). No `npm install`, no new
environment variables.** Optional clean-up: delete
`SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` from `apps/web/.env.local` if
they are there. Ember no longer reads them (Spotify's February 2026 API change
stopped them working for import), so leaving them does no harm either.

- **Spotify playlist links import again, with no setup**: Ember reads public
  playlists from Spotify's embed page, the first 100 songs of each. See
  SETUP.md, "Spotify playlist import (no setup)".
- **Imports run in the background**: the import now lives in the
  new-playlist dialog ("Import from a link" tab; the separate Import buttons
  are gone). Create makes the playlist at once and the server fills it in,
  one import at a time, with a progress ring in the sidebar. Closing the tab
  or restarting the server does not lose it: it picks up where it stopped.
  YouTube Music's "slow down" (503) pauses it briefly; a failed import can be
  retried and a running one stopped.
- **Better song matching**: every Spotify song gets up to five YouTube Music
  candidates, scored on title, artist, length, explicit flag, live, remix and
  cover versions, and official audio vs fan uploads. Only confident matches
  are added; the rest wait in a review sheet (keys 1 to 3 pick, S skips),
  and any imported song can be re-matched later from its menu.
- **YouTube playlists** fall back to yt-dlp when YouTube Music's API errors,
  and private or missing playlists get a clear message.

# 0.3.4: real trending songs

**Host: a normal rebuild and restart (`./update.sh`). No `npm install`, no
PocketBase changes.** Optional: set `TRENDING_COUNTRY` (for example `DE`) in
`apps/web/.env.local` to show one country's chart instead of the global one.
See SETUP.md, "Trending chart country".

- **Real trending songs**: the Trending shelf on Home now shows YouTube
  Music's actual daily chart, in chart order, refreshed every few hours. It
  used to be a plain "top hits" search. The search page shows the same chart
  before you type.
- The chart is cached in `my_music/trending.json`, so a restart shows it
  straight away. If YouTube is down, the last good chart keeps showing.

# 0.3.3: search fits smaller screens

**Host: a normal rebuild and restart (`./update.sh`). Nothing to configure:
no `npm install`, no new environment variables, no PocketBase changes.**

- **Search fits smaller screens**: the rows in the search pop-up now size
  their columns to the pop-up's own width instead of the window's, so song
  titles are no longer cut short on smaller screens or at higher Windows
  zoom levels.

# 0.3.2: profile pictures load everywhere

**Host: a normal rebuild and restart (`./update.sh`). Nothing to configure:
no `npm install`, no new environment variables, no PocketBase changes.**

- **Profile pictures load everywhere**: pictures are now served from the
  app's own address, so they no longer show as a broken image in the admin
  user list or right after someone changes their picture. When a picture
  cannot load, the initial shows instead.

# 0.3.1: cleaner collection pages

**Host: a normal rebuild and restart (`./update.sh`). Nothing to configure:
no `npm install`, no new environment variables, no PocketBase changes.**

- **Cleaner collection pages**: Liked songs, playlists, albums, artists and
  tracks now share one even layout, with more breathing room above and
  below the play buttons. Visual only; nothing a button does has changed.

# 0.3.0: What's new page and one app version

**Host: a normal rebuild and restart (`./update.sh`). No `npm install`, no
new environment variables.** PocketBase must restart so its hooks run:
`pb_hooks/ensure_changelog_fields.pb.js` adds two fields to `users` on boot,
`changelog_seen_version` (text) and `changelog_hide_new` (bool). Nothing to
do by hand, and existing users keep all their data.

- **What's new**: a new row in the sidebar (and in the phone menu) opens a
  page listing what changed, newest first. Entries released since a user last
  marked them read carry a pulsing New tag; the phone menu button gets a small
  dot. "Mark all as read" clears them, and "Don't show New tags" turns them
  off for good. Both are stored per user, so they follow people across web,
  desktop and phone.
- **Everyone starts with nothing marked New.** The first time someone opens
  this version, it is recorded as already seen.
- **Ember now has one version number, 0.3.0**, taken from
  `apps/web/package.json`. The settings footer and bug reports show it before
  the build hash, and `update.sh` prints it after the pull. The desktop and
  Android apps are set to 0.3.0 too, for the next time they are built.

# Update notes: crash logging and automatic restarts on the host

**Host: run the update from inside tmux from now on**, so the build happens
once and Ember keeps running after you disconnect. No PocketBase changes, no
`npm install`. This time:

1. `command -v lsof` (if it prints nothing: `sudo apt install lsof`).
2. `tmux new -s ember`
3. Inside it, if the old Ember is running in this terminal, stop it with Ctrl+C.
4. `./update.sh`
5. Wait for "App is live", then detach with Ctrl+B then D.

Later updates: `tmux attach -t ember`, Ctrl+C, `./update.sh`, detach again.
Do not use `nohup` instead of tmux: closing the SSH session still stops the
web app. Optional: set `DISCORD_CRASH_WEBHOOK_URL` in `apps/web/.env.local` to
send crash reports to their own channel; without it they go to the bug-report
channel. See SETUP.md, "Crash logging".

- **A crashed PocketBase or web app restarts by itself**, after 5 s, 30 s, then
  2 minutes. After 5 crashes in 10 minutes the watchdog says it is giving up,
  then retries quietly every 10 minutes and posts once when the service stays
  up again, so a broken build cannot flood the channel and a passing problem
  does not need anyone to log in.
- **Crashes are posted to Discord** with the last 50 lines of the service's
  log (secrets scrubbed), as are uncaught server errors inside the web app
  (the server keeps running after them), a closed SSH window that stopped
  Ember, and a start after a reboot or power loss. At most 10 posts an hour.
- **`update.sh` stops Ember before an `npm ci`**, and both scripts now need
  `lsof` and say so if it is missing.
- **Service output is kept on disk** in `logs/next.log`, `logs/pocketbase.log`
  and `logs/watchdog.log`, rotated at 5 MB.
- **Ports from the environment now win over `apps/web/.env.local`** in
  `start-static.sh` and `update.sh`, so a sandbox copy can run on spare ports.
  A host that never exports `PORT` or `POCKETBASE_PORT` sees no change.

# Update notes: send a feature or fix request from Settings > Help

**Host: a normal rebuild and restart. No PocketBase changes.** Set
`DISCORD_FEATURE_WEBHOOK_URL` and `DISCORD_FIX_WEBHOOK_URL` in
`apps/web/.env.local` to receive requests; without them the button still
shows but sending returns "Requests are not set up on this server" (see
SETUP.md).

- **A "Send a request" button next to Report a bug** opens a dialog where a
  signed-in user picks New feature or Fix, fills a name and a description (or
  recommended approach) plus an optional field, and it posts to its own
  Discord channel.

# Update notes: Reports you can read: timeline, seen-before, automatic crash reports, daily digest

**Host: a normal rebuild and restart is all this needs.** No schema changes,
no `npm install`. The daily digest is opt in: set `DIGEST_ENABLED=1` in
`apps/web/.env.local` to turn it on, and `DIGEST_HOUR` (default 8, host local
time) to move it. Without it the automatic crash reports still work; only the
once-a-day summary stays quiet.

- **A bug report now reads as a story, not a log dump.** The Discord message
  leads with what broke, then where, then an "Evidence" timeline where a
  client error and the server error for the same request sit together and
  stack traces are trimmed to the frame that matters.
- **"Seen before" tells you whether it is new.** Each server error in a report
  carries how many times that same error has happened in the past week, so a
  one-off is obvious at a glance and so is something that has been failing all
  week.
- **Crashes report themselves.** With the new "Send crash reports
  automatically" toggle in Settings, Help (on by default), an uncaught error
  sends a report without anyone having to notice and press a button. Deduped
  per error, capped at three a session, and titled "Automatic report" so you
  can tell them from the ones people chose to send.
- **A daily error digest lands in the same Discord channel.** Once a day,
  every server error of the last 24 hours grouped by fingerprint, with a short
  AI summary of what is worth looking at. `POST /api/admin/digest` sends one
  on demand. See SETUP.md, "Bug reports" for the details.
- **The admin Logs tab is gone.** The digest and the reports above replace it,
  and the page only ever existed on one machine: a stray `logs/` rule in
  `.gitignore` had been hiding it from git the whole time.

# Update notes: uploads keep their cover art

**Host: a normal rebuild and restart, plus `npm install` (a new dependency
reads the tags).** The new `artwork_ext` field on the `uploads` collection
comes from a hook under `pocketbase/pb_hooks`, so it appears the next time
PocketBase boots with `--hooksDir` pointed at it. Songs uploaded before this
keep working; they just stay artwork-less.

- **A song you upload keeps the cover that was in its file.** The cover is
  pulled out of the tag when the file lands and shown everywhere the app
  shows artwork, including on the phone offline once the pin has downloaded
  it.

# Update notes: Offline: artwork offline, retry from the index, signed-out downloads fail loudly

**Host: a normal rebuild and restart, plus a new APK for anyone on Android.**
No PocketBase changes, no `npm install`: this is app code only. The phone
needs the rebuilt APK because the cold-start page is bundled into it.

- **Downloaded songs keep their cover art offline.** A pin now downloads each
  track's artwork alongside its audio, and the player bar, the full Now
  Playing view, the lock screen and the cold-start page all show that local
  copy with the radio off.
- **Retry actually retries.** Settings, Downloads asks the app's own download
  index to re-queue just the failed tracks of a pin, so it no longer needs you
  to have opened that collection while online first.
- **A download that fails because you are signed out now says so.** It fails
  with "Sign in again" instead of quietly saving the sign-in page as the song,
  which used to show as Downloaded and then play nothing.
- **Recently played keeps its pin in step** with what you have actually
  played, the way Liked Songs already did.

# Update notes: Bug reports carry more

**Host: a normal restart is all this needs.** No schema changes, no `npm install`.

- **Bug reports now include a "State when reported" snapshot** (route, current track, queue position, online/offline, playback backend), client and server logs correlated by request id, native-app failures on Android, and the desktop app's own log tail on Tauri.
- **AI triage (if you've set `ANTHROPIC_API_KEY`) now guesses reproduction steps too**, shown as "Reproduce" in both the Discord embed and the in-app diagnosis. See SETUP.md → "Bug reports → your Discord channel" for the full list of what a report contains.

# Update notes: unavailable songs

**Host: a normal restart is all this needs.** The two new PocketBase fields
on `tracks` (`unavailable_at`, `unavailable_reason`) come from a hook under
`pocketbase/pb_hooks`, so they appear the next time PocketBase boots with
`--hooksDir` pointed at it, same as any other hook. Nothing to migrate by
hand, no `npm install`.

- **Removed YouTube videos now show as Unavailable, are skipped during
  playback, and can be swapped for another upload from the row.**

# Update notes: July 2026 feature batch

**Host: do these after `git pull` on `main`.**

## 1. Full restart (required)

```bash
./start-static.sh
```

Both parts matter this time:
- **PocketBase must restart**: a new hook (`pb_hooks/ensure_sessions.pb.js`)
  creates the three *carlist session* collections on boot. Live sessions
  don't work until PB has rebooted once.
- The web app rebuild picks up everything else (player.py also changed,
  the launcher restarts it all).

No `npm install` needed: no dependency changes.

## 2. Spotify playlist import (optional, ~2 min)

YouTube Music import works out of the box. For Spotify links, follow
**SETUP.md → "Spotify playlist import"**: create a free app at
developer.spotify.com and put into `apps/web/.env.local`:

```bash
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
```

Until then, Spotify links show a friendly "not set up" message.

## What's in this batch

- **Carlist live sessions**: Library → Session: one phone plays, everyone
  who joins by code/link adds songs + can skip (see in-app).
- **Playlist import** from Spotify + YouTube Music (Library → Import).
- **Voice search** (mic in the search bar: Chrome/Edge/Safari; Firefox
  shows a hint).
- **Recent searches** on the search page (the tracks you played, Spotify-style).
- **Android app: download playlists and Liked songs for offline; reinstall the APK.**
- **Discord/Messenger embed cards** for shared song links (nothing to
  configure; `/track/...` pages are now public so crawlers can read them).
- Fixes: removed playlist songs leave the live queue immediately; loop
  toggle can't trap a single looping song anymore; friendly error toasts;
  same-name artists no longer share an artist page; error-handler crash on
  PocketBase network failures.

---

# This release: host checklist

1. **Full restart (required)**: `./start-static.sh`. PocketBase must reboot:
   hooks create the `uploads` collection and add the two privacy fields to
   `users`. Uploads and the privacy switches don't work until it has.
2. **Optional:** `ANTHROPIC_API_KEY` in `apps/web/.env.local` turns on AI
   triage of bug reports (SETUP.md → "Bug reports"). Everything works
   without it.
3. Nothing else: no `npm install`, no new services.

What's in it:

- **Guitar tabs**: a button in the player finds the tab for the playing song
  on Songsterr (links out; they block embedding).
- **Generated guitar tabs**: the tabs dialog can now write a tab from the
  song's own recording, no Guitar Pro file needed. Rough in places, in time
  with the song. Needs the optional Python packages from SETUP.md
  ("Generated guitar tabs"); without them the button just reports a failure.
- **Android app: native player + Android Auto**: browse playlists, likes,
  recents and uploads, search and voice, shuffle/repeat, radio at the end of
  the queue, all from the car. Reinstall the APK (older APKs keep working
  against this server). Sideloads need Android Auto's "Unknown sources".
- **Discord presence follows the song**: the card is now "Listening to Ember"
  with a progress bar that tracks seeks, pauses and resumes. Desktop builds
  need `DISCORD_APP_ID` at build time (CI has it; local builds pass it to
  `build-mac.sh`). Each presence decision is logged in the desktop log as
  `discord: …`.
- **AI bug triage**: reports arrive in Discord with a summary, likely cause
  and what to check first, instead of only raw logs.
- **Custom uploads**: Library → Upload adds a song from your own files;
  everyone on the server can search and play it. 50MB per file
  (`MAX_UPLOAD_MB`), 10 per person per hour. Audio lives in
  `MUSIC_DIR/uploads` and is exempt from the 14-day cleanup.
- **Privacy switches**: Settings → Profile: hide what you're playing from
  Discord rich presence and/or "Friends are listening to", independently.
  Default is visible, so nobody's behaviour changes on upgrade.
- **Shuffle**: lives next to Play in a playlist and toggles without skipping
  the current song; gone from the bottom bar.
- **Native apps**: Tauri desktop (macOS/Windows/Linux) with a native audio
  engine, OS media controls, Discord presence and auto-update; Capacitor
  Android; an iOS scaffold. See `apps/desktop/README.md` and
  `apps/mobile/README.md`. The desktop auto-updater points at
  `/api/desktop/update`. Set `GITHUB_RELEASES_TOKEN` (SETUP.md → "Desktop
  auto-update") to switch it on; without it the apps simply never self-update.
- **Release builds**: tagging `v*` builds every platform in CI and publishes
  one installer per OS to a GitHub Release.

Delete this file whenever it stops being useful.
