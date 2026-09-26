/** A fresh signed-in member for sandbox tests, as a Cookie header value.
 *
 *  Fetching a song the host does not have yet takes a signed-in member
 *  (security audit 2026-09-25, M2), so the stream tests that make the fake
 *  player download need one. Creates the user with the sandbox PocketBase's
 *  superuser and signs it in.
 *
 *  Env: PB_URL (default http://127.0.0.1:8091), PB_ADMIN_EMAIL (default
 *  admin@ember.com), PB_ADMIN_PASSWORD (required: the sandbox superuser's). */
export async function memberCookie({ pb = process.env.PB_URL ?? 'http://127.0.0.1:8091', label = 'listener' } = {}) {
  const identity = process.env.PB_ADMIN_EMAIL ?? 'admin@ember.com';
  const password = process.env.PB_ADMIN_PASSWORD;
  if (!password) throw new Error('set PB_ADMIN_PASSWORD to the sandbox superuser password (see tests/README.md)');
  let admin = null;
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(pb + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity, password }) });
    if (r.ok) { admin = (await r.json()).token; break; }
  }
  if (!admin) throw new Error(`no superuser sign-in on ${pb}`);
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@ember.test`;
  const pw = `Pw-${Math.random().toString(36).slice(2)}-x9`;
  const created = await fetch(`${pb}/api/collections/users/records`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: admin },
    body: JSON.stringify({ email, password: pw, passwordConfirm: pw, name: label, verified: true }),
  });
  if (!created.ok) throw new Error(`could not create a member: ${created.status}`);
  const auth = await fetch(`${pb}/api/collections/users/auth-with-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: pw }),
  }).then((r) => r.json());
  if (!auth.token) throw new Error('member sign-in failed');
  return `pb_auth=${encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }))}`;
}
