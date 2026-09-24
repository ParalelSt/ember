#!/usr/bin/env node
// Inject EMBER_APP_URL into src-tauri/tauri.conf.json before `tauri dev` / `tauri build`.
//
// Tauri 2 reads the window target URL from app.windows[].url at config-load time and
// does not interpolate env vars there, so we resolve the URL here and write it in.
//
//   EMBER_APP_URL=https://ember.<tailnet>.ts.net npm run build
//   (default: http://localhost:3000)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const confPath = join(__dirname, "..", "src-tauri", "tauri.conf.json");
const capPath = join(__dirname, "..", "src-tauri", "capabilities", "default.json");

const url = process.env.EMBER_APP_URL?.trim() || "http://localhost:3000";

// Validate it's a real http(s) URL so we fail loudly instead of producing a broken window.
try {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`unsupported protocol: ${parsed.protocol}`);
  }
} catch (err) {
  console.error(`[set-url] EMBER_APP_URL is not a valid http(s) URL: "${url}"\n  ${err.message}`);
  process.exit(1);
}

const conf = JSON.parse(readFileSync(confPath, "utf8"));
const win = conf.app?.windows?.[0];
if (!win) {
  console.error("[set-url] could not find app.windows[0] in tauri.conf.json");
  process.exit(1);
}

win.url = url;

// The update feed lives on the same server the app loads. Keeping it in step
// with EMBER_APP_URL matters: a build pointed at one server that checks
// another for updates would "work" right up until it installed the wrong
// thing. The {{...}} placeholders are filled in by Tauri at check time.
if (conf.plugins?.updater) {
  conf.plugins.updater.endpoints = [
    `${new URL(url).origin}/api/desktop/update/{{target}}/{{arch}}/{{current_version}}`,
  ];
}

writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");

// The capability must list the SAME origin, or the remote page gets no IPC
// access and every invoke() (native audio, discord, logging) silently fails.
//
// It must NOT also list localhost:3000 unconditionally (bughunt L3): that
// used to be added every time "for dev convenience", which meant a signed
// build shipped to point at the real server (build-signed.sh, build-mac.sh
// with no --local) still granted full IPC — native audio, Discord presence,
// log reading — to anything answering on the user's own machine at
// localhost:3000. `npm run dev` and `build-mac.sh --local` already resolve
// `url` to http://localhost:3000, so `origin` alone still covers them.
const cap = JSON.parse(readFileSync(capPath, "utf8"));
const origin = new URL(url).origin;
cap.remote = { urls: [origin] };
writeFileSync(capPath, JSON.stringify(cap, null, 2) + "\n");

console.log(`[set-url] main window will load: ${url}`);
console.log(`[set-url] capability grants IPC to: ${cap.remote.urls.join(", ")}`);
if (conf.plugins?.updater) {
  console.log(`[set-url] update feed: ${conf.plugins.updater.endpoints[0]}`);
}
