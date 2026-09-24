# O2. Closing the SSH window after `./update.sh` took Ember down
**What you'd notice:** you run `./update.sh` over SSH or PuTTY, it finishes the update and shows Ember running, you close the window, and the site goes down. Discord gets "Ember stopped: terminal closed".
**Why it happened:** at the end, `update.sh` restarted Ember inside the same terminal window it was run from. SETUP.md tells you to run Ember inside tmux, but `update.sh` never did that, so an update run from a plain SSH window quietly moved Ember out of tmux.
**What changed:** run from a plain SSH window, `update.sh` now restarts Ember in the background, in a tmux session called `ember`, checks the watchdog came up, and finishes. Run inside tmux, nothing changes: Ember restarts right there, as before. If tmux isn't installed, `update.sh` stops before changing anything and tells you what to do. `./update.sh --here` keeps the old behaviour. Files: `update.sh`, `SETUP.md` (Updating), new test `tests/update-script.test.sh`.
**Compare:** before = `cadce0d`, after = `945b759`.
- Test: `bash tests/update-script.test.sh` (real `update.sh` against a throwaway git "host" with fake npm, npx and tmux; the SSH window closing is a SIGHUP to the update's process group).
  - Before: `FAIL  update.sh finishes instead of keeping Ember in this terminal`, `FAIL  closing the SSH window does not stop Ember`, `FAIL  without tmux, update.sh refuses`. 8/26.
  - After: 26/26. `bash tests/watchdog.test.sh` still 124/124.
- Try it yourself: on the host, from a plain SSH window: `./update.sh`, wait for "Ember is running in the background", close the window, open the site.
**What changes for you:** after an update from a plain SSH window you get your prompt back. To watch Ember: `tmux attach -t ember` (leave with Ctrl+B, then D). If you already had an `ember` tmux session, Ember opens in a new window inside it. On a host without tmux: `sudo apt install tmux` once.
**Risk:** low. Inside tmux the update behaves exactly as before; a missing tmux is caught before anything is pulled or stopped.
