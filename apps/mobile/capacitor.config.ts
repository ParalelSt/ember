import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Ember is a Next.js *server* app — it cannot be statically bundled into the
 * native app. These mobile apps are THIN WEBVIEW WRAPPERS that load the LIVE
 * server URL via Capacitor's `server.url`. There is no bundled `dist`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * EMBER_APP_URL — the live server the webview points at.
 *
 *   Default: http://localhost:3000  (Mac-local dev only)
 *
 *   ⚠️  A PHYSICAL PHONE CANNOT REACH `localhost` — localhost on the phone is
 *       the phone itself, not your Mac. On a real device you MUST set
 *       EMBER_APP_URL to one of:
 *         • the Tailscale funnel URL:  https://ember.<tailnet>.ts.net   (preferred, https)
 *         • your Mac's LAN IP:         http://192.168.x.x:3000          (http, needs cleartext)
 *
 *   Set it before `cap sync` / `cap run`, e.g.:
 *       EMBER_APP_URL="https://ember.<tailnet>.ts.net" npx cap sync
 * ───────────────────────────────────────────────────────────────────────────
 */
const serverUrl = process.env.EMBER_APP_URL ?? 'http://localhost:3000';

const config: CapacitorConfig = {
  appId: 'app.ember.music',
  appName: 'Ember',
  // Capacitor REQUIRES webDir to exist (must contain an index.html) even when
  // server.url is set. This is only a fallback "connecting…" page that the
  // webview shows before/if it can't reach the live server.
  webDir: 'public',
  server: {
    url: serverUrl,
    // Needed for an http:// dev URL (localhost / LAN IP). Harmless for https
    // funnel URLs. When true, `cap sync` adds android:usesCleartextTraffic.
    cleartext: true,
  },
  android: {
    // Allow the webview to load mixed content during development (e.g. http
    // assets). Not for production — prefer the https Tailscale funnel there.
    allowMixedContent: true,
  },
};

export default config;
