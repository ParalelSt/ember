import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import pkg from "./package.json";

// Where the real PocketBase server lives (server-side / proxy target).
const POCKETBASE_ORIGIN = process.env.POCKETBASE_URL ?? 'http://127.0.0.1:8090';

// Build-time version stamp: the app version from package.json (the one the
// changelog tracks, see docs/changelog-system.md) plus short git SHA and build
// date, e.g. "0.3.0 (a1b2c3d 2026-09-18)". Shown in the settings footer +
// logged to the console on boot + attached to bug reports, so "which version
// is actually running?" is answerable at a glance on any deployment.
function appVersion(): string {
  let sha = 'unknown';
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    // Not a git checkout (tarball deploy) — keep 'unknown'.
  }
  return `${pkg.version} (${sha} ${new Date().toISOString().slice(0, 10)})`;
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion(),
  },
  // Allow tunnel hostnames to talk to the dev server. Without this, Next 16
  // blocks cross-origin dev requests as a CSRF safeguard. Add a custom domain
  // here too if you run `next dev` behind a named tunnel on one.
  allowedDevOrigins: ['*.trycloudflare.com', '*.ts.net'],

  // Same-origin proxy for PocketBase: the browser calls `/pb/*` and Next
  // forwards it to the real PocketBase server. This keeps the whole app on a
  // single public origin, so one static tunnel URL covers everything.
  async rewrites() {
    return [
      { source: '/pb/:path*', destination: `${POCKETBASE_ORIGIN}/:path*` },
    ];
  },
};

export default nextConfig;
