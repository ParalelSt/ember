# O5. Starting Ember on a busy port crash-looped instead of saying why
**What you'd notice:** after the watchdog was killed hard (or something else took port 3000), `./start-static.sh` looked fine, then posted a string of "Next crashed" and "giving up" messages to Discord, while an old copy of the app kept serving the old version with nobody watching it.
**Why it happened:** the web app and PocketBase deliberately keep running if the watchdog dies, so they survive a `kill -9`. The next start never looked at the web port and just launched a second copy, which could not get the port and crashed again and again.
**What changed:** the watchdog now writes down which process it started for each service (`logs/next.pid`, `logs/pocketbase.pid`). On the next start, anything on the ports that it recognises as left over from its own previous run is stopped first, then fresh copies start under supervision. Anything else on the ports gets a plain refusal naming the port and the process, and Ember does not start. A PocketBase you started by hand is still used as it is. Files: `start-static.sh`, `SETUP.md` (log file table).
**Compare:** before = `01623fc`, after = `d4b2a90`.
- Test: `bash tests/watchdog.test.sh` (section 11, "ports already in use"), real `start-static.sh` with fake services on random ports.
  - Before: `FAIL  a busy web port: start-static refuses and exits`, `FAIL  the next start stops the old web app`, `FAIL  no crash loop: no crash post`. 111/124.
  - After: 124/124.
- Try it yourself: none needed on the sandbox.
**What changes for you:** nothing on a normal start or `./update.sh` (they already free the ports). If a start is refused, the message says which program holds the port and how to stop it.
**Risk:** low. It only ever stops a process it recorded itself, and only if that process is on Ember's own port.
