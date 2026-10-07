/** The second lock on the QR sign-in routes that act as the signed-in member
 *  (approve, deny, lookup, revoke), after SameSite=Lax on pb_auth (plan 2b,
 *  section 3 "CSRF on approve / deny"):
 *
 *   - the body must be JSON: an HTML form on another site cannot send that
 *     content type without a CORS preflight, which this app never answers
 *   - an Origin header, when there is one, must be this app's own host (the
 *     Host header, the proxy's X-Forwarded-Host, or PUBLIC_ORIGIN)
 *   - a browser that says Sec-Fetch-Site: cross-site is refused outright
 *
 *  Returns the refusal to send, or null when the request may go on. */
export function csrfRefusal(req: Request): Response | null {
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    return Response.json({ error: 'Send JSON' }, { status: 415 });
  }
  if ((req.headers.get('sec-fetch-site') ?? '').toLowerCase() === 'cross-site') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const origin = req.headers.get('origin');
  if (origin === null) return null;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!originHost || !ownHosts(req).has(originHost)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

function ownHosts(req: Request): Set<string> {
  const hosts = new Set<string>();
  const add = (h: string | null | undefined) => {
    const v = (h ?? '').split(',')[0].trim().toLowerCase();
    if (v) hosts.add(v);
  };
  add(req.headers.get('host'));
  add(req.headers.get('x-forwarded-host'));
  try {
    add(new URL(req.url).host);
  } catch {
    // A relative URL never reaches a route handler; nothing to add.
  }
  const configured = (process.env.PUBLIC_ORIGIN ?? '').trim();
  if (configured) {
    try {
      add(new URL(configured).host);
    } catch {
      // A malformed PUBLIC_ORIGIN adds nothing.
    }
  }
  return hosts;
}
