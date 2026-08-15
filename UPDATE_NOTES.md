# Update notes — July 2026 feature batch

**Host: do these after `git pull` on `main`.**

## 1. Full restart (required)

```bash
./start-static.sh
```

Both parts matter this time:
- **PocketBase must restart** — a new hook (`pb_hooks/ensure_sessions.pb.js`)
  creates the three *carlist session* collections on boot. Live sessions
  don't work until PB has rebooted once.
- The web app rebuild picks up everything else (player.py also changed —
  the launcher restarts it all).

No `npm install` needed — no dependency changes.

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

- **Carlist live sessions** — Library → Session: one phone plays, everyone
  who joins by code/link adds songs + can skip (see in-app).
- **Playlist import** from Spotify + YouTube Music (Library → Import).
- **Voice search** (mic in the search bar — Chrome/Edge/Safari; Firefox
  shows a hint).
- **Recent searches** on the search page (the tracks you played, Spotify-style).
- **Discord/Messenger embed cards** for shared song links (nothing to
  configure; `/track/...` pages are now public so crawlers can read them).
- Fixes: removed playlist songs leave the live queue immediately; loop
  toggle can't trap a single looping song anymore; friendly error toasts;
  same-name artists no longer share an artist page; error-handler crash on
  PocketBase network failures.

---

# Next batch — branch `feat/next-batch` (NOT on main yet)

When this branch merges, the host needs:

1. **Full restart again** — `pb_hooks/ensure_uploads.pb.js` creates the
   `uploads` collection on boot. Custom song uploads don't work until
   PocketBase has rebooted once.
2. **Optional:** `ANTHROPIC_API_KEY` in `apps/web/.env.local` turns on AI
   triage of bug reports (SETUP.md → "Bug reports"). Everything works
   without it.
3. Nothing else — no `npm install`, no new services.

Contents:
- **Guitar tabs** — a guitar-icon button in the player finds the tab for
  the playing song on Songsterr (links out; they block embedding).
- **AI bug triage** — reports arrive in Discord with a summary, likely
  cause and what to check first, instead of only raw logs.
- **Custom uploads** — Library → Upload adds a song from your own files;
  everyone on the server can search and play it. 50MB per file by default
  (`MAX_UPLOAD_MB`), 10 uploads per person per hour. Uploaded audio lives
  in `MUSIC_DIR/uploads` and is exempt from the 14-day cleanup.

Delete this file whenever it stops being useful.
