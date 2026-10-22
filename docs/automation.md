# Automation scripts

Things that used to take a long back and forth with Claude, as one command.
Each one costs no tokens to run, and when Claude runs them it reads one short
summary instead of doing every step by hand.

## Built

### Release: `npm run release`

1. Write a notes file (anywhere, e.g. `notes.md`):

   ```
   id: add-to-queue
   title: Add to queue
   summary: Put any song next in line from its ... menu.
   - The ... menu on a song in a playlist now has Add to queue.
   - Queued songs play in the order you added them.
   host: Optional extra sentence for the host.
   ```

2. `npm run release -- prepare notes.md` for a web-only release, or add
   `--shells` when the desktop or phone apps changed too. It:
   - stops if there are uncommitted changes or the branch is missing commits
     from origin/main;
   - refuses notes with em dashes, pranks, a reused id or missing parts;
   - bumps the web version (and with `--shells`: Tauri, Cargo, Android
     versionName + versionCode, iOS);
   - writes the What's new entry and the UPDATE_NOTES.md block for the host;
   - runs every test suite at once (`npm run release:check`);
   - commits `chore(release): web X[ and shells Y], title` and shows the
     preview. Nothing is pushed.

3. `npm run release -- push` shows the preview again and only after you type
   `push` pushes to main and, for shell releases, pushes the `vX` tag (which
   makes GitHub build the apps) and follows that build.

`npm run release -- preview` shows what would go out at any time.

### Every test suite: `npm run release:check [-- --shells]`

Web (vitest), the em dash guard, the release script tests and Python run in
parallel; `--shells` adds Rust and Android. One pass/FAIL line per suite, the
last lines of anything that failed, full logs in `.release-logs/`.

### Test app: `npm run test-apk [-- <branch>] [--port 3050 | --server URL]`

Builds "Ember Test" (its own package, name and blue icon, next to the real
app) from any branch in its own worktree, pointed at a sandbox server on this
Mac's LAN address, and serves it at `http://<LAN IP>:8780/EmberTest.apk`.

## Ideas, most useful first

| Command | What it would do | Why it saves time |
|---|---|---|
| `npm run branch -- fix/x` | New worktree off origin/main with node_modules linked, never `npm install` | Done by hand for every task; avoids the npm worktree hazard |
| `npm run sandbox -- <branch> [--port]` | Start or stop a sandbox app + PocketBase for a branch, with SINK=1 always on, refusing :3000/:8090 and live pb_data | The most repeated setup, and the riskiest to get wrong |
| `npm run reports` | Pull every Ember Discord channel since the last run into `docs/reports/`, new items only | What "fix the reported bugs" starts with every time |
| `npm run notes-draft` | Turn the commits since main into a notes.md skeleton to edit | The release then needs only a quick edit of the wording |
| `npm run notify -- "text"` | Phone push + Discord DM in one go | Every "done" or "need you" message |
| `npm run shots -- /library /playlist/x` | Desktop and phone screenshots of pages on a sandbox | Design reviews like the popup overview |
| `npm run tidy-branches` | List merged branches and worktrees (about 40 today) and delete the ones you confirm | Keeps the repo and disk clean |
| git pre-push hook | Secret scan, em dashes and prank words before anything leaves the Mac | Catches the house rules without a reminder |
| `npm run host-check` | Compare the host's version with the newest release and say if `./update.sh` is due | Needs the host reachable (it is on a friend's tailnet) |
