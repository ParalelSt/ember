# O3. PocketBase and the app could end up with two different superuser passwords
**What you'd notice:** after changing `POCKETBASE_ADMIN_PASSWORD` to something with a `$`, `#` or quote in it, sign-up and the invite check on `/auth` fail with "Failed to authenticate as PB admin", even after a restart.
**Why it happened:** the web app reads `apps/web/.env.local` with Next's loader, which understands quotes, `#` comments and `$` variables. `start-static.sh` (which hands the password to PocketBase) read the same line with a much simpler rule. For `Xy7$abc#def"q` the app used `Xy7` and PocketBase got `Xy7$abc#defq`.
**What changed:** both scripts now ask Next's own loader for the value (a tiny helper), so PocketBase always gets exactly what the app sees, including values in `apps/web/.env`. If Next isn't installed yet (fresh clone), they fall back to the old reader and print a warning. If a `$` or `#` changes your password, start-up says so, without ever printing it. Files: `scripts/read-env.mjs` (new), `start-static.sh`, `update.sh`, `SETUP.md` (step 4, one line).
**Compare:** before = `a2b200c`, after = `c83b96c`.
- Test: `bash tests/watchdog.test.sh` (section 10, "one .env.local parser"). Starts the real `start-static.sh` with fake services, six awkward passwords.
  - Before: `FAIL  a $ and a # in the value: PocketBase gets the password the web app sees`, same for a trailing comment, an `export` line, single quotes and a password only in `.env`. 96/102.
  - After: 103/103, including "the password is not printed" for every case.
- Try it yourself: nothing to click. On the host, `./update.sh` as usual.
**What changes for you:** nothing if your password is letters and digits (as SETUP.md recommends). If it isn't, start-up now prints a warning; the app and PocketBase still agree.
**Risk:** low. Same values as before for plain passwords; the old reader stays as the fallback.
