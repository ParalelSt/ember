# Ember — Setup

**Parts:** PocketBase (backend, port 8090) · Next (web app, port 3000, proxies `/pb` → PocketBase).

Commands below are **bash**. macOS / Linux: any terminal works. **Windows:** install Git for Windows and use the **Git Bash** terminal it bundles — every command below then works as-is.

## Prereqs (download once)

- **Git** — https://git-scm.com/downloads. *Windows users:* this installs **Git Bash**, your terminal for the rest of this guide.
- **Node.js 20+** — https://nodejs.org/en/download → LTS installer.
- **PocketBase binary** — https://github.com/pocketbase/pocketbase/releases (use v0.22.21). Pick your OS, unzip, drop the executable (`pocketbase` on Mac/Linux, `pocketbase.exe` on Windows) into this repo's `pocketbase/` folder. Gitignored, so fresh clones don't have it.
- **cloudflared** (only needed for `./start.sh`) — https://github.com/cloudflare/cloudflared/releases. Drop into `pocketbase/` too.

## First time

```bash
git clone https://github.com/ParalelSt/ember.git
cd ember
npm install
cp apps/web/.env.example apps/web/.env.local
cd pocketbase && ./pocketbase serve
```

Open http://127.0.0.1:8090/_/ in your browser → create the **backend admin** account on first run. (This manages PocketBase; your app users sign up separately.)

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

Static `https://ember.<your-tailnet>.ts.net` over the public internet. Free. Your computer must stay **on + signed into Tailscale** for the URL to work; phones/users just visit it.

**1. Install Tailscale** — https://tailscale.com/download picks the right installer for Mac / Linux / Windows. Install → open the app once → sign in (Google / Microsoft / GitHub / Apple — creates your tailnet). Verify the CLI:

```bash
tailscale --version
```

If "command not found":
- **macOS:** Tailscale menu bar → *Preferences* → **Install CLI**.
- **Windows:** make sure you installed the system installer (not the Store app); restart Git Bash.
- **Linux:** the official install script (`curl -fsSL https://tailscale.com/install.sh | sh`) gives the CLI directly.

**2. Admin console** at https://login.tailscale.com/admin (same in any browser):

- *DNS* → scroll to **HTTPS Certificates** → click **Enable HTTPS**.
- *Machines* → click this computer → *Edit machine name* → set to **`ember`**.
- Back on the machine row → toggle **Funnel** on.

If you don't see a Funnel toggle, do this instead — open *Access controls* in the left sidebar (it shows the ACL as JSON), then **add a new top-level key** `nodeAttrs`. Paste this block just before the final closing `}` of the file:

```jsonc
"nodeAttrs": [
  {"target": ["autogroup:member"], "attr": ["funnel"]},
],
```

If the line before it doesn't already end with a comma, add one — Tailscale's ACL is HuJSON, so trailing commas are fine, and the comma between top-level keys is what matters. Click **Save**, then refresh the *Machines* page and the Funnel toggle will appear.

**3. Start the public tunnel (once — persists across reboots):**

```bash
tailscale funnel --bg 3000
```

It prints `https://ember.<your-tailnet>.ts.net` — your permanent URL.

**4. Run the app:**

```bash
./start-static.sh
```

Stop the tunnel later: `tailscale funnel reset`.

**Friend hosting?** Same prereqs + steps on his computer (any OS). His URL = `ember.<his-tailnet>.ts.net`. Phones never install anything.

## Bug reports

The "Report a bug" button in the sidebar / drawer delivers structured diagnostics + an optional note to a Discord channel.

**Project-owner setup (you, once):** paste your Discord webhook URL into the `DEFAULT_WEBHOOK_URL` constant at the top of [`apps/web/app/api/bug-report/route.ts`](apps/web/app/api/bug-report/route.ts), then commit. Every clone (including friends self-hosting) will deliver bug reports to that channel. Create the webhook in Discord under *Server Settings → Integrations → Webhooks → New Webhook*.

**Local override (anyone):** to test against a different channel without changing source, set `DISCORD_BUG_REPORT_WEBHOOK_URL` in `apps/web/.env.local`; it wins over the baked-in default.

Server-side error logs live at `logs/errors-YYYY-MM-DD.jsonl` (gitignored, auto-deleted after 2 days). The Discord channel is the long-term archive.

If the baked-in webhook ever gets abused, delete + recreate it in Discord and rebuild — the new URL replaces the old one in the next push.

## Reset the database (wipes all users + data)

```bash
rm -rf pocketbase/pb_data && cd pocketbase && ./pocketbase serve
```
