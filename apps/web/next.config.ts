import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow Cloudflare quick tunnels (and any tunneled origin) to talk to the
  // dev server. Without this, Next 16 blocks cross-origin dev requests as a
  // CSRF safeguard.
  allowedDevOrigins: ['*.trycloudflare.com'],
};

export default nextConfig;
