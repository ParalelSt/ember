import 'server-only';

/** The origin a DESKTOP APP can actually reach this server on.
 *
 *  `new URL(request.url).origin` is the origin the Next process saw, which
 *  behind a reverse proxy is the internal one. Ember is normally served
 *  through a Tailscale Funnel or similar, which forwards to something like
 *  http://localhost:30200 — so the update feed was handing installers a
 *  download URL pointing at `localhost` ON THE LISTENER'S OWN MACHINE. The
 *  update check succeeded and the download then failed, which is the worst
 *  shape of bug: silent, and only in production.
 *
 *  Order of trust:
 *   1. PUBLIC_ORIGIN, when the host has set it. Always correct, never guessed.
 *   2. The X-Forwarded-* headers a proxy sets.
 *   3. The request's own origin, which is right when nothing is in front. */
export function publicOrigin(request: Request): string {
  const configured = (process.env.PUBLIC_ORIGIN ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;

  const h = request.headers;
  const forwardedHost = h.get('x-forwarded-host') ?? h.get('forwarded-host');
  if (forwardedHost) {
    const host = forwardedHost.split(',')[0].trim();
    const proto = (h.get('x-forwarded-proto') ?? '').split(',')[0].trim() || 'https';
    if (host) return `${proto}://${host}`;
  }
  return new URL(request.url).origin;
}

/** Whether an origin is one only the server itself could reach. A manifest
 *  built on one of these is useless to every client, so it is worth saying so
 *  out loud rather than shipping a download nobody can fetch. */
export function isLoopback(origin: string): boolean {
  try {
    // URL.hostname keeps the brackets on IPv6 literals ("[::1]").
    const hostname = new URL(origin).hostname.replace(/^\[|\]$/g, '');
    return (
      hostname === 'localhost' ||
      hostname === '::1' ||
      hostname.endsWith('.localhost') ||
      /^127\./.test(hostname) ||
      /^0\.0\.0\.0$/.test(hostname)
    );
  } catch {
    return false;
  }
}
