// Public routes (no session required). /track is public so shared song links
// unfurl (Discord/Messenger crawlers can't log in) and logged-out friends land
// on the track page instead of the auth wall. /privacy and /terms are linked
// from Google's permission screen for the YouTube Music transfer, and Google
// requires them to load for anyone. Shared by proxy.ts (the sign-in gate) and
// lib/api.ts (which never bounces a public page to sign in).
export const PUBLIC_PATHS = ['/auth', '/manifest.webmanifest', '/sw.js', '/track', '/privacy', '/terms'];

export function isPublicPage(path: string): boolean {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'));
}
