import type { NextConfig } from "next";

// Where the real PocketBase server lives (server-side / proxy target).
const POCKETBASE_ORIGIN = process.env.POCKETBASE_URL ?? 'http://127.0.0.1:8090';

const nextConfig: NextConfig = {
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
