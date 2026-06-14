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
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");
console.log(`[set-url] main window will load: ${url}`);
