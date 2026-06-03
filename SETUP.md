# Ember — Setup

**Parts:** PocketBase (backend, port 8090) · Next (web app, port 3000, proxies `/pb` → PocketBase).

Mac steps below — adapt commands for Linux/Windows (downloads work cross-platform).

## Prereqs (download once)

- **Node.js 20+** — https://nodejs.org/en/download → LTS installer.
- **PocketBase binary** — https://github.com/pocketbase/pocketbase/releases (use v0.22.21). Pick your OS, unzip, drop `pocketbase` (or `pocketbase.exe`) into this repo's `pocketbase/` folder. The binary is gitignored, so fresh clones don't have it.
- **cloudflared** (only needed for `./start.sh`) — https://github.com/cloudflare/cloudflared/releases. Drop into `pocketbase/` too.

## First time

```bash
git clone https://github.com/ParalelSt/ember.git
cd ember
npm install
cp apps/web/.env.example apps/web/.env.local
cd pocketbase && ./pocketbase serve
```

In your browser, open http://127.0.0.1:8090/_/ → create the **backend admin** account on first run. (This is for managing PocketBase; your app users sign up separately.)

## Run locally

Two terminals, both from the repo root:

```bash
cd pocketbase && ./pocketbase serve   # terminal 1
npm run dev                           # terminal 2
```

Open http://localhost:3000 → sign up in the app (password **≥ 8 chars**).

## Host from your PC (ephemeral URL — quick test)

Needs `cloudflared` in `pocketbase/` (see Prereqs). From the repo root:

```bash
./start.sh
```

Prints a public URL — open it on your phone. `Ctrl+C` stops everything. **URL changes every restart.**

## Permanent URL (free, no domain) — Tailscale Funnel

Static `https://ember.<your-tailnet>.ts.net` over the public internet. Free. Only the host needs Tailscale; phones/users just open the URL. Your Mac has to be **on + signed into Tailscale** for the URL to work.

**1. Install Tailscale** — `.pkg` from https://tailscale.com/download/mac → install → **open the Tailscale app once** → sign in with Google / Microsoft / GitHub / Apple (creates your tailnet). Verify the CLI is available:

```bash
tailscale --version
```

If "command not found", open the Tailscale app menu bar item → Preferences → click *Install CLI* (or `sudo ln -s /Applications/Tailscale.app/Contents/MacOS/Tailscale /usr/local/bin/tailscale`).

**2. Admin console** at https://login.tailscale.com/admin:

- *DNS* → scroll to **HTTPS Certificates** → click **Enable HTTPS**.
- *Machines* → click this Mac → *Edit machine name* → set to **`ember`**.
- Back on the machine row → toggle **Funnel** on. If the toggle isn't there: *Access controls* → add the line `"nodeAttrs": [{"target": ["autogroup:member"], "attr": ["funnel"]}]` inside the JSON, save.

**3. Start the public tunnel (once — persists across reboots):**

```bash
tailscale funnel --bg 3000
```

It prints `https://ember.<your-tailnet>.ts.net` — that's your permanent URL.

**4. Run the app:**

```bash
./start-static.sh
```

Stop the tunnel later: `tailscale funnel reset`.

**Friend wants to host instead?** Same prereqs + steps on his PC. His URL = `ember.<his-tailnet>.ts.net`. Phones never install anything.

## Reset the database (wipes all users + data)

```bash
rm -rf pocketbase/pb_data && cd pocketbase && ./pocketbase serve
```
