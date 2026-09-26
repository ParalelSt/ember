# 0.7.12: Security, playback and bug-report fixes (apps 0.4.9)

**Host, before updating:** set `DISCORD_BUG_REPORT_WEBHOOK_URL` in
`apps/web/.env.local` (ask the owner for the URL). The webhook that used to be
built into the code was found by a public secret scanner and Discord deleted
it, so bug reports, lyrics reports and the daily digest need this line now.
Without it they answer "not configured" instead of posting.

**Then run `./update.sh` as usual (no new packages, no database changes).**
It restarts PocketBase, which applies the security rules on boot: the log
should show `[ensure_owner_rules]` once per collection. PocketBase now starts
with `--automigrate=0`, so it no longer writes migration files by itself
(that could crash it on start).

What changes:

- Security: members can no longer read another member's likes, history or
  private playlist names, or move their records into someone else's account.
  Sign-in and password reset are limited to 20 tries per 15 minutes.
- Playing a song the server does not have yet needs a signed-in member.
  Shared links still play songs the server already has. There is a limit of
  60 new songs a minute per member. No length or size cap (opt in with
  `EMBER_MAX_TRACK_MINUTES` / `EMBER_MAX_DOWNLOAD_MB` if ever needed).
- The desktop update route only serves update files.
- Playback fixes for the web player, the desktop app and the Android app,
  and same-volume-for-every-song on Android.
- The Android fixes (session cookie, player access, no plain http except to
  your own http server) need the new apps, 0.4.9 (Android versionCode 14),
  which the `v0.4.9` tag builds.

# 0.7.9: Web app fixes (batch 5)

**Host: run `./update.sh` as usual (no new packages, no settings, no database
changes).** Web only: the apps stay at 0.4.7. The fixes take effect once the
server restarts and reach everyone at their next page load. Background:
`docs/reports/bughunt-2026-09-24/` W04, W05, V5, W06, W07, W09 to W13, M1,
M2 and M3.

# 0.7.8: Server fixes (batch 4)

**Host: run `./update.sh` as usual (no new packages, no settings, no database
changes).** The server fixes take effect once it restarts. The Android menu
and sheets clearing the phone's buttons need the new apps, 0.4.7 (Android
versionCode 12), which the `v0.4.7` tag builds. Background:
`docs/reports/bughunt-2026-09-24/` S01, S02, S03, S05 to S12 and T3, and
`docs/reports/android-nav-overlap.md`.

# 0.7.7: App fixes (batch 3)

**Host: `./update.sh` as usual (no new packages, no settings, no database
changes).** This release is the Android and desktop apps: the web side only
gets the changelog entry. The fixes need the new apps, 0.4.6 (Android
versionCode 11), which the `v0.4.6` tag builds. Background:
`docs/reports/bughunt-2026-09-24/` A3, A4, A6, A7, A8, A9, A12, L4 and L5.

# 0.7.6: Playback fixes (batch 2)

**Host: `./update.sh` as usual (no new packages, no settings, no database
changes).** The web fixes reach everyone at their next page load. Repeat one
on the desktop app, and the loop button, shuffle and taps on Android, need
the new apps, 0.4.5 (Android versionCode 10), which the `v0.4.5` tag builds.
Background: `docs/reports/bughunt-2026-09-24/` P02, P04, P05, P06, P08, P10,
P11 and P12.

# 0.7.5: Security fixes (batch 1)

**Host, in order. Do all of it: the code fix alone is not enough, because
the old database admin password is in the public repo's history. The
desktop app needs the new shell, 0.4.4, which the `v0.4.4` tag builds (the
APK only gets a version bump). Background: `docs/reports/bughunt-2026-09-24/W14-pocketbase-admin-exposed.md`.**

1. **Make a new password** for PocketBase's admin (the "superuser"):
   `openssl rand -base64 24 | tr -d '/+='`
2. **Put it in `apps/web/.env.local`.** Keep the email exactly as it is, so
   the existing superuser gets the new password instead of a second account
   being made:

   ```
   POCKETBASE_ADMIN_EMAIL=admin@ember.com
   POCKETBASE_ADMIN_PASSWORD=<the new password>
   ```
   PocketBase and the web app now both read these two lines
   (`start-static.sh` hands them to PocketBase), so they cannot drift apart.
   Nothing else in `.env.local` changes. (Only for a brand-new database:
   `EMBER_ADMIN_EMAIL` / `EMBER_ADMIN_PASSWORD` create your own Ember admin
   account if it does not exist yet; an existing account is never touched.)
3. **`./update.sh`**. It rebuilds the app and restarts PocketBase, which is
   what applies the new database rules and hooks (admin role, uploads,
   shared song details, carlists) and sets the new password. Check:
   `grep ensure_superuser logs/pocketbase.log | tail -3` should say
   `updated the superuser password for admin@ember.com`.
4. **Check the OLD password no longer works** (this reads it from git
   history, so nobody has to type it):

   ```
   OLD=$(git show e482ce8:apps/web/.env.example | sed -n 's/^POCKETBASE_ADMIN_PASSWORD=//p')
   [ -n "$OLD" ] && curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8090/api/admins/auth-with-password \
     -H 'content-type: application/json' -d "{\"identity\":\"admin@ember.com\",\"password\":\"$OLD\"}"
   ```
   `400` is good: the old password is dead. `200` means step 2 or 3 did not
   take. (Use your `POCKETBASE_PORT` if it is not 8090.) Then open
   `https://<your-funnel-url>/pb/_/` in a browser: it should say "Not
   found". And sign in to Ember normally: that proves the app has the new
   password too.
5. **Your own Ember admin account.** If its password was never changed
   since the first install, the old one is public too. Check:

   ```
   OLDA=$(git show e482ce8:pocketbase/pb_hooks/ensure_admin.pb.js | sed -n 's/.*ADMIN_PASSWORD = "\([^"]*\)".*/\1/p')
   EMAIL=$(git show e482ce8:pocketbase/pb_hooks/ensure_admin.pb.js | sed -n 's/.*ADMIN_EMAIL = "\([^"]*\)".*/\1/p')
   curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8090/api/collections/users/auth-with-password \
     -H 'content-type: application/json' -d "{\"identity\":\"$EMAIL\",\"password\":\"$OLDA\"}"
   ```
   `200` means change it now (Ember, Admin, Users, Reset password on your
   row). `400` means it was already changed.
6. **Consider making the GitHub repo private** (the repo, Settings, Danger
   Zone, Change visibility). It does not un-leak the old passwords, but the
   next mistake of this kind stays private.
7. **Look for signs someone got in**: the three `sqlite3` checks in step 7
   of the W14 report. Only `admin@ember.com` should be a superuser, only
   people you made admin should be admins, and a `200` on
   `/api/admins/auth-with-password` from any address other than
   `127.0.0.1` means someone was in.

Also in this update, no action needed: searches and song lookups now take
turns (at most 4 at once, `PYTHON_MAX_CONCURRENCY`) and the public search,
album, artist and song routes have per-caller limits; downloads keep the
`MAX_CONCURRENT_DOWNLOADS` cap from 0.7.4. The PocketBase admin screen now
opens only on the host itself (`http://127.0.0.1:8090/_/`) or through an
SSH tunnel (`SETUP.md`, Troubleshooting).

# 0.7.4: Keeps playing when the internet drops (auto cache)

**Host, in order: `./update.sh` as usual, then (optional) one env line.
The desktop app and the APK need the new shells, 0.4.3, which the `v0.4.3`
tag builds.**

1. **`./update.sh`** (a normal rebuild and restart, no new packages, no
   database changes). From now on the host runs at most two yt-dlp
   downloads at once, whatever the number of listeners; the rest wait their
   turn. The apps' "save the next songs" requests carry `?prefetch=1` and
   are low priority: they only start a download when the host is idle
   (otherwise `503` with `Retry-After: 30`, logged as a warning, not an
   error) and each listener gets 10 a minute (`429`). Details in
   `docs/prefetch.md`.
2. **Optional: `MAX_CONCURRENT_DOWNLOADS`** in `apps/web/.env.local`, then
   restart the web app. Leave it out and the cap is 2, which is right for a
   handful of friends; raise it only if the host has spare CPU and plays
   queue up behind each other.

   ```
   MAX_CONCURRENT_DOWNLOADS=2
   ```
3. **New shells, 0.4.3** (desktop app, and the APK with versionCode 8). The
   browser gets the auto cache at its next page load. An older desktop app
   or APK keeps playing as before and Settings > Downloads says to update
   the app.

# 0.7.2: Songs start reliably in the desktop app again

**Host, in order: `./update.sh` as usual, then (once, if not done before)
the guitar tab packages below, then restart the web app.**

1. **`./update.sh`** (a normal rebuild and restart, no new packages). The
   web fix (a song loads once, not twice) reaches every desktop app at its
   next page load. The engine fixes need the new desktop app, 0.4.2, which
   the `v0.4.2` tag builds.
2. **Guitar tab packages, one time** (SETUP.md, "Generated guitar tabs").
   Without them every tab found online logs "lining the tab up failed" as a
   server error, and those errors show up in every bug report.

   ```bash
   .venv/bin/pip install 'setuptools<80'
   .venv/bin/pip install --no-deps basic-pitch
   .venv/bin/pip install onnxruntime librosa pretty_midi 'resampy<0.4.3' mir_eval scikit-learn typing-extensions
   ```

   `update.sh` does not install these. See `docs/reports/luka-2026-09-24.md`.

# 0.6.0: Admin pranks (plan-23-9)

**Host, in order: `./update.sh` as usual, then a new Android APK for the
prank sound to reach the app there.**

1. **`./update.sh`** (a normal rebuild and restart). Restarting PocketBase
   runs `pb_hooks/ensure_pranks.pb.js`, which creates the `pranks`,
   `prank_sounds` and `prank_schedules` collections on first boot; nothing
   to do by hand.
2. **A new Android APK** is what brings prank sound playback to the app;
   an older APK still receives a prank but logs "their app cannot do that
   yet" instead of playing it. Web and desktop (through the desktop app's
   webview overlay) already work once the host is updated.
3. See `docs/pranks.md` for what the feature does, its limits, and the
   `PRANK_TICK_DISABLED` / `PRANK_TICK_INTERVAL_MS` env settings.

# 0.5.0: Bring your liked songs over

**Host, in order: `./update.sh` as usual (it restarts PocketBase, which is
what the new fields need), then, for YouTube Music, add two lines to
`apps/web/.env.local` and restart once more.**

1. **`./update.sh`** (a normal rebuild and restart, no new packages).
   PocketBase's boot hooks add, with nothing to do by hand and nothing
   removed:
   - `pb_hooks/ensure_likes_fields.pb.js`: `likes.liked_at` (date) and
     `likes.origin` (`user` or `import`), filled in for every existing like
     (`liked_at` = when it was made, `origin` = `user`) on first boot.
   - `pb_hooks/ensure_imports.pb.js`: `import_jobs.existing`, more values
     for `import_jobs.source`, and `import_items.liked_at`.
2. **Google sign-in for YouTube Music (optional, but it is the easy way
   in for friends).** Without it the YouTube Music choice says the server
   is not set up and offers a playlist link instead; nothing breaks. With
   it, anyone can bring their YouTube Music likes over by typing a short
   code at google.com/device. The Google project (called Ember) is set up
   once, by the owner; the host only needs its two values:

   ```
   GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
   ```

   in `apps/web/.env.local`, then restart Ember. The secret stays on the
   host and is never sent to a browser. How the Google project is made is
   in `docs/imports.md`, section 11.
3. **`/privacy` and `/terms` are new public pages** (no login needed),
   because Google's permission screen links to them. Nothing to do; they
   are what the Google project's Branding page points at.
4. **Outbound internet** to `oauth2.googleapis.com` and
   `www.googleapis.com` is what the Google sign-in uses, only while a
   person is transferring.

# 0.4.0: Guitar tabs, properly

**Host, in order: `./update.sh` as usual, then restart PocketBase once.**

1. **`./update.sh`** (a normal rebuild and restart). It now also installs
   Ember's own ffmpeg and links it: `imageio-ffmpeg` is new in
   `requirements.txt`, it ships a static ffmpeg binary in the wheel, and
   every run installs it into `.venv` if missing and relinks
   `.venv/bin/ffmpeg` to it (an upgrade of the package renames the binary,
   so the link is redone each run). **No system ffmpeg install is needed
   any more**: `player.py` (yt-dlp) and `transcribe.py` (tab generation)
   find it through `ffmpeg_path.py`, and a system ffmpeg on `PATH` is only
   the fallback. Check it with
   `./.venv/bin/python ffmpeg_path.py`, which prints the binary it will
   use. If pip cannot reach the network, update.sh prints a warning and
   carries on: tab generation and some downloads will fail until it can.
   If you install Python packages by hand instead, re-run
   `./.venv/bin/pip install -r requirements.txt`.
2. **Restart PocketBase once** so its boot hooks run. Nothing to do by
   hand, and no row or file is removed:
   - `pb_hooks/ensure_tabs.pb.js` turns `tabs` into the one tab store:
     new fields `song_key`, `track_key`, `kind`, `format`, `shared`,
     `offset_ms`, `hints`, the `source_*` set (`source_site`,
     `source_url`, `source_id`, `source_rating`, `source_votes`,
     `source_meta`), `timing` and `aligned_at`; new list/view/delete
     rules; `user` becomes optional.
   - The same hook creates a **new `tab_lookups` collection** (one row per
     song and site Ember has already searched, so a song is searched once),
     admin only.
   - `pb_hooks/ensure_plugin_settings.pb.js` adds one field, `plugins`
     (JSON), to `users`.
3. **No new environment variables, and no `npm install`.**
   `SONGSTERR_BASE`, `SONGSTERR_CDN_BASE` and `UG_BASE` exist only so the
   test sandbox can point at the fakes; a real server leaves them unset.
4. **Outbound internet** to `songsterr.com` and `ultimate-guitar.com` is
   what the automatic tab fetching uses. Ember is polite about it: a
   browser User-Agent, one queue per site with 2 s between requests, at
   most 3 requests per song, an hour's backoff on a 429 or 503, and a miss
   remembered for a day. Nothing re-fetches on its own.

- **Tabs are found online by themselves**: open a song and Ember searches
  Songsterr first, then Ultimate Guitar, once per song, and keeps what it
  finds for everyone on the server. Songsterr tabs come with real rhythm
  and every instrument in one tab; Ultimate Guitar contributes text tabs.
- **Tabs line themselves up with the recording** (`align.py`): Ember
  listens to the song and puts the tab where it actually plays, even when
  the band drifts. Every tab found for a song sits in one Source sheet you
  can open and pick from, with its rating and whether it lines up, and the
  best match is drawn by default.
- **The tab page**: the guitar button opens `/tabs/<song>` instead of the
  old dialog. The cursor follows the song, clicking a bar jumps there,
  and the line can be dragged anywhere (with the time shown as you go,
  and the arrow keys moving a beat at a time). Guitar and bass with each
  one's tuning, Tab or Tab and Score, a sideways mode, pasting in a text
  tab, and search links to the tab sites when nothing is found.
- **Tabs can be switched off** in Settings > Plugins. Those plugin
  switches are now saved on the account, so they match on every device.
  The first device to load after the update writes its current switches up
  for that account; other devices then take the account's values. Signed
  out, each device keeps its own.
- **Tabs added before this version stay private** to whoever added them;
  everything new is shared with the server.
- **A song that will not load fails in seconds**: when a download fails
  and the live stream cannot stand in either, the server answers a real
  error at once instead of running yt-dlp a second time over, or never
  answering. The proxy also puts a clock on the upstream's headers (6 s)
  and on silence inside the body (10 s); a slow but progressing stream is
  untouched. **Desktop users need the next app release** for the native
  half of this (the server half helps them straight away): the native
  engine now judges a source on progress rather than spending one flat 25
  second budget, and keeps the web-audio fallback for failures web audio
  can actually fix. The underlying trigger is still a stale yt-dlp on the
  host, which `./update.sh` updates.
- **Radio works for every song**: a small slice of YouTube ids legitimately
  start with a dash, and those seeds were failing the recommendation
  lookup with a 502.
- **Instrumental, live and remix versions stay separate** from the
  original: the shared song identity behind the liked heart, radio's
  dedup and the unavailable-track replacement no longer collapses them
  into one. A pure code change to a runtime comparison, so there is
  nothing to migrate.

- **The phone player bar**: the song name now has a full-width line of its
  own above the controls (358px at a 390px phone against the old 38px), and
  it scrolls when a name is too long for even that. Play is 56px, previous,
  next, the queue button and the artwork are 48px. Nothing on a desktop or
  tablet window changed.
- **The Android app must be rebuilt for the safe-area fix.** The bar and the
  bottom nav sitting under Android's back, home and recents buttons was half
  a native bug: the app targets SDK 35, where the system draws itself over
  the WebView, and the WebView reports nothing through
  `env(safe-area-inset-bottom)`. `MainActivity` now reads the window insets
  itself and publishes them to the page as `--ember-inset-*`, which the web
  side folds into one `--safe-bottom` token. **The web half alone changes
  nothing on the phone**: the lift only appears once a new APK is installed
  (`cd apps/mobile/android && ./gradlew assembleDebug`, or the usual release
  build). Nothing to do on the host for it, and no new dependency: it is
  ordinary AndroidX insets plus the `androidx.webkit` the app already had.
  Android 14 and below are untouched, because there the system does not draw
  over the WebView and the insets arrive as 0.

*(Version: this one entry replaces the separate 0.3.2, 0.3.3, 0.3.7, 0.3.8
and 0.3.9 sections the four merged branches each wrote for themselves.)*
# 0.3.11: Search without losing your place

**Host: a normal rebuild and restart (`./update.sh`). Nothing to configure:
no `npm install`, no new environment variables, no PocketBase change.**

- **Search stops taking over the screen**: on a desktop window the search
  box now lives in the page, at the top of the content column, and the
  results hang under it as an ordinary dropdown. There is no backdrop and
  nothing is disabled, so the player bar, the sidebar and the page behind it
  all stay clickable while search is open.
- **Start a song and keep looking**: pressing play on a result no longer
  closes anything. Escape, a click anywhere outside it, or going to another
  page closes it; Escape puts the cursor back where it was.
- **Phones are unchanged**: below the `md` width, search is still the
  full-screen sheet it has always been, which is the right shape there.
- **The `/` shortcut is unchanged too**: it now puts the cursor in the
  in-page box instead of opening a dialog. `/search` is still a real route
  for deep links, and on a desktop window the shell's box steps aside there
  so the page's own box is the only one.

*(Version number: this branch used 0.3.11 because 0.4.0 is taken by other
unmerged branches; it may be renumbered when it merges.)*

# 0.3.10: Play straight from search

**Host: a normal rebuild and restart (`./update.sh`). Nothing to configure:
no `npm install`, no new environment variables, no PocketBase change.**

- **A play button in the search box**: every row in the search overlay, both
  the results and the recent searches above them, now has a play/pause
  button at its right end. It appears when you point at a row or tab to it,
  and stays visible on the row that is playing, so the same button pauses
  and starts it again.
- **The song playing is easier to spot**: its title is drawn in the ember
  accent colour, in the results and in recent searches alike.

*(Version number: this branch used 0.3.10 because 0.3.7 to 0.3.9 are taken
by other unmerged branches; it may be renumbered when it merges.)*

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
