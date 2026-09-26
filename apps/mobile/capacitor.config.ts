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
 *         • your Mac's LAN IP:         http://192.168.x.x:3000          (http, see below)
 *
 *   Cleartext HTTP is off on Android except to THIS host when it is http://
 *   (android/app/network-security.gradle generates the config from the URL
 *   at build time). An https server gets no cleartext at all.
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
    // Only meaningful for an http:// server. On Android the real switch is
    // the generated network security config, which allows cleartext to this
    // server's host alone (security audit 2026-09-25, M5).
    cleartext: serverUrl.startsWith('http://'),
    // With no network the server's pages cannot load at all, so a cold start
    // would sit on "Connecting to server…" forever even with downloads on the
    // phone. Capacitor loads this bundled page instead when the remote URL
    // fails: a small offline player over the EmberOffline plugin's pins.
    errorPath: 'offline.html',
  },
  android: {
    // An https page never loads http content (MainActivity enforces it too,
    // via WebSecurity.lockDown). An http server is not affected.
    allowMixedContent: false,
  },
};

export default config;
