# O6. The "run at boot" systemd file could never start Ember
**What you'd notice:** following the old instructions in `deploy/ember.service` (`systemctl --user enable --now ember`) gave a unit that failed straight away, so Ember never came back by itself after a reboot.
**Why it happened:** the file was left over from an early version of Ember. It ran `apps/api/src/index.js`, which no longer exists, on port 4040, and knew nothing about PocketBase or the watchdog.
**What changed:** the unit now runs `./start-static.sh`, the same watchdog you use in tmux, with systemd told to signal only the watchdog on stop (it stops both services itself, no crash report) and to wait 35 s, longer than the watchdog's worst case. `./update.sh` notices when systemd runs Ember and restarts it through systemd instead of tmux. SETUP.md has a new "Run Ember at boot (systemd, optional)" section. Files: `deploy/ember.service`, `update.sh`, `SETUP.md`.
**Compare:** before = `10c0e18`, after = `4733106`.
- Test: `bash tests/update-script.test.sh` (section "the systemd unit"): checks the unit's settings, runs its command the way systemd does on a throwaway host, stops it the way systemd does, and runs `update.sh` with a fake `systemctl` reporting the unit active.
  - Before: `FAIL  every file its command names exists`, `FAIL  the unit's command brings Ember up`, `FAIL  it restarts Ember through systemd`. 35/46.
  - After: 46/46.
- Try it yourself: needs the Linux host (no systemd on a Mac). See SETUP.md, "Run Ember at boot".
**What changes for you:** nothing unless you choose systemd. If you do: install it once (copy, fix the folder path if Ember isn't in `~/ember`, enable, `enable-linger`), stop the tmux copy first, and keep using `./update.sh`.
**Risk:** low. Nothing uses the unit until you install it; `update.sh` only takes the systemd route when the unit is actually running.
