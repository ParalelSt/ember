# W14. URGENT: the database's master account was open to the internet, with its password in the public repo

**Status:** fixed in code. **You still have to act on the host: the steps below. The code fix alone is not enough.**

**What was wrong, in plain words:**
- PocketBase (Ember's database) has one master account, the "superuser". It can read and change everything: every member's email, password hash, playlists, likes and settings, and it can download a full copy of the database.
- Its email and password were written into `pocketbase/pb_hooks/ensure_superuser.pb.js` and `apps/web/.env.example`. The GitHub repo `ParalelSt/ember` is public, so anyone could read them. The first password of your own Ember admin account was in `ensure_admin.pb.js` too.
- The public app forwards everything under `/pb/` to PocketBase, including the superuser's sign-in and the admin screen at `/pb/_/`. So anyone who read the repo could very likely have signed in to your live database as superuser, from anywhere, through your Tailscale Funnel URL.
- The hook also put that same password back on every restart, so even changing it in the admin screen never stuck.

**Why fixing the code is not enough:** those passwords are in the repo's history on GitHub forever, and copies may already exist. Until the host uses NEW passwords, treat the old ones as known to strangers.

**What changed:**
1. The app refuses PocketBase's superuser surface with a plain 404: the admin screen (`/pb/_/`), superuser sign-in and management (`/pb/api/admins`), settings, backups, logs and collection definitions, however the address is spelled. Member sign-in, likes, playlists, files and live updates go through as before. The server's own superuser sign-in never used `/pb` (it talks to PocketBase directly on the host), so it keeps working. Files: `apps/web/proxy.ts`, `apps/web/next.config.ts`.
2. No passwords in the code any more. The superuser comes from `POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD` in `apps/web/.env.local` (the same two values the web app already uses, so they can't drift apart); `start-static.sh` hands them to PocketBase alone. If they are missing, PocketBase changes nothing and only warns, so you can't be locked out. Your admin account is only created when `EMBER_ADMIN_EMAIL` / `EMBER_ADMIN_PASSWORD` are set and it doesn't exist yet; an existing password is never touched. Files: `pocketbase/pb_hooks/ensure_superuser.pb.js`, `ensure_admin.pb.js`, `start-static.sh`, `update.sh`, `apps/web/.env.example`, `SETUP.md`.

**Compare:** before = `0646e44`, after = `6260fde` (the /pb block), `900668d` (passwords from env), `cc01827` (browser checks).
- Test: `node tests/pb-admin-exposure.test.mjs` (throwaway PocketBase on 8086, app on 3053). Before: `FAIL A2 superuser sign-in through /pb answers 404 even with the right password (status 200)`, `FAIL A4 GET /pb/api/settings answers 404 (status 401)`, 9/24 passed. After: 26/26 passed, including member sign-in in a real browser.
- Test: `PB_BIN=<pocketbase binary> node tests/pb-hooks-credentials.test.mjs`. Before: `FAIL S1d after a reboot with the env unset, that password still works`, 2/14. After: 14/14.
- Test: `cd apps/web && npx vitest run proxy.test.ts`. Before: `expected 200 to be 404` for `/pb/api/admins/auth-with-password`. After: 10/10. Also `bash tests/watchdog.test.sh`: 85/85 (was 80/85 on the new checks).

## What to do on the host, in this order

Run these in the Ember folder on the host (where `start-static.sh` is).

**1. Deploy this change.** Once it is merged to `main`: `./update.sh`. Then check the public URL shows the 404: open `https://<your-funnel-url>/pb/_/` in a browser. It should say "Not found".

**2. Set NEW passwords.** Make two long random ones: run `openssl rand -base64 24 | tr -d '/+='` twice. Open `apps/web/.env.local` and set:
```
POCKETBASE_ADMIN_EMAIL=admin@ember.com
POCKETBASE_ADMIN_PASSWORD=<first new password>
```
Keep the email as it is (so the existing superuser gets the new password instead of a second account being made). Only if you ever want Ember to create your admin account on a fresh database, also add `EMBER_ADMIN_EMAIL=<your email>` and `EMBER_ADMIN_PASSWORD=<second new password>`; on this host it already exists and is never changed by it.

**3. Restart PocketBase:** run `./update.sh` again (it always restarts both PocketBase and the app). Then `grep ensure_superuser logs/pocketbase.log | tail -3` should say `updated the superuser password for admin@ember.com`.

**4. Prove the OLD superuser password no longer works.** This reads the old password from git history, so you don't have to type it:
```
OLD=$(git show 0646e44:apps/web/.env.example | sed -n 's/^POCKETBASE_ADMIN_PASSWORD=//p')
[ -n "$OLD" ] && curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8090/api/admins/auth-with-password \
  -H 'content-type: application/json' -d "{\"identity\":\"admin@ember.com\",\"password\":\"$OLD\"}"
```
`400` = good, the old password is dead. `200` = it still works: step 2 or 3 didn't take. (Use your `POCKETBASE_PORT` if it isn't 8090.) Then sign in to Ember and invite-check an email on `/auth`: it should work, which proves the app has the new password too.

**5. Your own admin account.** If you never changed its password since the first install, the old one is public. Check:
```
OLDA=$(git show 0646e44:pocketbase/pb_hooks/ensure_admin.pb.js | sed -n 's/.*ADMIN_PASSWORD = "\([^"]*\)".*/\1/p')
EMAIL=$(git show 0646e44:pocketbase/pb_hooks/ensure_admin.pb.js | sed -n 's/.*ADMIN_EMAIL = "\([^"]*\)".*/\1/p')
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8090/api/collections/users/auth-with-password \
  -H 'content-type: application/json' -d "{\"identity\":\"$EMAIL\",\"password\":\"$OLDA\"}"
```
`200` means change it now: in Ember, Admin, Users, the Reset password button on your row. `400` means it was already changed.

**6. Consider making the repo private** (GitHub, the repo, Settings, Danger Zone, Change visibility). It doesn't un-leak the old passwords, but the next mistake of this kind stays private. The desktop auto-updater already expects a private repo (`GITHUB_RELEASES_TOKEN`).

**7. Look for signs someone got in.** On the host:
```
sqlite3 pocketbase/pb_data/data.db "select email, created, updated from _admins"
sqlite3 pocketbase/pb_data/data.db "select email, created from users where is_admin = 1"
sqlite3 pocketbase/pb_data/logs.db "select created, json_extract(data,'\$.method'), json_extract(data,'\$.url'), json_extract(data,'\$.status'), json_extract(data,'\$.userIp') from _logs where json_extract(data,'\$.url') like '/api/admins%' or json_extract(data,'\$.url') like '/api/backups%' or json_extract(data,'\$.url') like '/api/settings%' order by created desc limit 100"
```
- Superusers: only `admin@ember.com` should be listed. Delete anything else in PocketBase's admin screen on the host (`http://127.0.0.1:8090/_/`, Settings, Admins).
- Admins in the app: only people you made admin.
- Logs: sign-ins from `127.0.0.1` are the app itself. A `200` on `/api/admins/auth-with-password` from any other address, or any `/api/backups` or `/api/settings` line you didn't cause, means someone was in. PocketBase keeps request logs for a few days only, so look soon. If you find anything: assume members' emails were read, tell them, and change any other secret you stored in PocketBase's settings (mail or storage passwords).

**Left as is:** the old superuser password is still the default in the sandbox test scripts under `tests/`. It is already public and only meant for throwaway test databases; it is harmless once the host stops using it (steps 2 to 4). The PocketBase admin screen now opens only on the host itself, or through an SSH tunnel (`SETUP.md`, Troubleshooting).
**Risk:** low for the app: the 404 covers only superuser routes (unit, HTTP and browser checks confirm sign-in, likes and playlists work). The one thing to get right is step 2: the app and PocketBase must share the new password, which `start-static.sh` now does for you.
