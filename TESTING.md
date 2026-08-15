# What to test right now

**Everything except the native apps is now on `test-branch`.** One checkout,
one build, test it all:

```bash
cd "/Users/aronmatoic/Documents/Main Projects/spotify-clone"
git checkout test-branch
./start-static.sh
```

Open http://localhost:3000. (Runs against your LOCAL database, so you'll see
your own playlists, not the server's.) Hard-refresh with Cmd+Shift+R if the UI
looks stale.

---

## 1. Shuffle  ← the new one
1. Open a playlist, start a song **in the middle** of it.
2. Click the shuffle icon in the bottom bar (just left of the loop icon).
   On a phone it's in the full-screen now-playing view.
3. ✅ The song keeps playing without a stutter; the songs *after* it get
   reordered; songs before it stay put.
4. Click shuffle again.
5. ✅ The playlist returns to its exact original order, still on the same song.

## 2. Recent searches sync  — you already confirmed this works
Search, play a track, then open Ember on another device with the same account.
The recents list matches; removing on one removes on both.

## 3. Friends are listening to
Have someone else play something, then look at Home.
✅ A row appears with their name and track. Hidden when nobody's listening.

## 4. Cleanup (safe to inspect — deletes nothing by default)
Signed in as admin:

```bash
curl -X POST http://localhost:3000/api/admin/cleanup \
  -H 'Content-Type: application/json' -d '{}'
```
✅ Reports what it *would* delete (`"dryRun": true`), removes nothing.
Add `-d '{"apply":true}'` to really run it, then check your liked songs and
playlists are untouched. Only tracks nobody played in 14 days should go.

## 5. Faster replays (403 work — already on main too)
Play a new song, then play it again. The second time should start almost
instantly, because it now comes from disk instead of YouTube.

When done: `git checkout main && ./start-static.sh`

---

## Already live on main (your friend just pulls + restarts)
- 403 fix / disk caching — **you confirmed this works**
- Quieter default volume on new devices
- Firefox Android layout no longer jumps when scrolling

Server-side, not code: fix the cookie path (`cookies.txt`, no `../` — it's in
`apps/web/`), install Deno, and update yt-dlp.

---

## Native apps — separate branches, separate testing

### `native-shell` — Android
Install `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.
✅ Plays, keeps playing when you switch apps or lock the screen, notification
controls work, Ember flame icon.

### `native-shell` — desktop
A built `Ember.app` already exists at
`apps/desktop/src-tauri/target/release/bundle/macos/`. Nobody has confirmed
audio actually comes out of it yet.
✅ Open it, play something, check sound + that media keys and macOS Now Playing
control it.

### `feat/discord-desktop-presence`
Needs a rebuild with your Discord app id:
```bash
cd apps/desktop
DISCORD_APP_ID=<id> EMBER_APP_URL="https://ember.tailf4de41.ts.net" npm run build
```
✅ With Discord open, playing a song shows it on **your own** profile.

---

Tell me what passes and I'll merge it to main.
