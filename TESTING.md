# What to test right now

Two groups: **things already on main** (your friend pulls, everyone can test on
the real URL) and **things on branches** (need a checkout to try).

---

## GROUP 1 — already on main

Your friend runs, on the server:

```bash
git pull
./start-static.sh
```

### 1. 403s / songs failing to play  ← the important one
- Play a handful of songs you've **never played before**. They should start in
  ~3 seconds.
- Play those same songs **again**. Second time should start almost instantly
  (well under a second) — that means it's now coming from the server's disk,
  not YouTube.
- Skip around inside a long track. Seeking should be instant on a song you've
  played before.
- ✅ Pass = far fewer "song won't play" errors, and replays are fast.
- Note: a brand-new song can still occasionally fail on the *first* press.
  Pressing play again should work. Tell me if that happens a lot.

### 2. Volume is no longer deafening
- Open Ember on a device you've **never used before** (or clear site data).
- ✅ Pass = first song starts quiet-ish, slider sitting in the first quarter.
- Existing devices keep whatever volume you already set — that's intended.

### 3. Firefox on Android — layout jumping
- Open the app in Firefox on your phone, scroll hard up and down.
- ✅ Pass = the app doesn't shift up when the address bar hides.

### Also worth doing on the server (not a test, a fix)
- Fix the cookie path: the file is in `apps/web/`, so it must be
  `YTDLP_COOKIE_FILE=cookies.txt` (no `../`), or an absolute path.
  It fails **silently** if wrong.
- Install Deno (`curl -fsSL https://deno.land/install.sh | sh`) — yt-dlp warns
  it has no JavaScript runtime, which is a likely cause of the 403s.
- Update yt-dlp: `.venv/bin/pip install -U yt-dlp` (4 months out of date).

---

## GROUP 2 — on branches (not live)

To try one, from the repo:

```bash
git checkout <branch>
./start-static.sh
```

(Then `git checkout main && ./start-static.sh` to go back.)

### `feat/shuffle` — shuffle playlists
1. Open a playlist and start playing a song in the **middle** of it.
2. Hit the shuffle icon (next to the loop icon, bottom bar; on phones it's in
   the full-screen player).
3. ✅ The song keeps playing without interruption, and the *upcoming* songs are
   reordered. Already-played ones stay put.
4. Hit shuffle again to turn it off.
5. ✅ The playlist goes back to its exact original order, still on the same song.

### `feat/db-cleanup` — auto-delete unplayed songs
Safe to inspect without deleting anything. While signed in as admin:

```bash
curl -X POST http://127.0.0.1:3000/api/admin/cleanup \
  -H 'Content-Type: application/json' -d '{}'
```

- ✅ It reports how many tracks it *would* delete and how much disk it'd free,
  and deletes nothing (`"dryRun": true`).
- Add `-d '{"apply":true}'` to actually run it.
- ✅ Check afterwards that your liked songs and playlists are all still intact —
  nothing you care about should ever be removed, only tracks nobody has played
  in 14 days.

### `test-branch` — recent searches sync + friends listening
1. **Recents sync:** search something and play it. Now open Ember on a
   *different device* (or a private window) with the same account.
   ✅ The search page shows the same recent tracks. Remove one → gone on both.
2. **Friends are listening to:** have someone else play a song, then look at
   your Home page. ✅ A row appears showing their name and what they're playing.
   It hides itself when nobody's listening.

### `feat/discord-desktop-presence` — Discord status
Needs the desktop app and a Discord application id:

```bash
cd apps/desktop
DISCORD_APP_ID=<your-app-id> EMBER_APP_URL="https://ember.tailf4de41.ts.net" npm run build
```

- Run the built app with Discord open, play a song.
- ✅ Your own Discord profile shows the track. (The old version could only ever
  show the host's status — this is the fix.)

### `native-shell` — Android app
- Install `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
  on your phone.
- ✅ Ember opens, plays, and **keeps playing when you switch apps** or lock the
  screen, with working notification controls.
- ✅ App icon is the Ember flame.

---

## Priority if you only have 15 minutes

1. 403s / replay speed (Group 1) — the thing people actually complain about
2. Shuffle (`feat/shuffle`) — quick and self-contained
3. Recents sync on two devices (`test-branch`)

Tell me which pass and I'll merge them to main.
