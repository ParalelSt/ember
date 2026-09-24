/** Spike for the admin pranks delivery channel: does a PocketBase realtime
 *  (SSE) subscription stream through the app's same-origin `/pb` rewrite
 *  under `next start`?
 *
 *      PB_URL=http://127.0.0.1:8089 APP_URL=http://127.0.0.1:3051 \
 *        node tests/pranks-realtime.spike.mjs
 *
 *  Speaks the realtime protocol by hand (the same two requests the JS SDK
 *  makes): GET /pb/api/realtime for the event stream, POST /pb/api/realtime
 *  with the user's token to subscribe to `pranks/*` filtered to their own
 *  pending rows. Then the admin client creates one row for this user and one
 *  for somebody else, and the spike asserts the first arrives within 2 s and
 *  the second never does (the collection's view rule is the fence).
 *
 *  Needs a sandbox PocketBase with pb_hooks/ensure_pranks.pb.js loaded, and
 *  an app built with POCKETBASE_URL pointing at it. */

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8089';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3051';
const PASSWORD = 'SpikeTest2026!';

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const res = await fetch(`${PB_URL}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: 'admin@ember.com', password: 'egKa5WNMx3QpuG7' }) });
    if (res.ok) return (await res.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

const admin = await adminToken();
const run = `${process.pid}-${Math.floor(Math.random() * 1e6)}`;

async function member(tag) {
  const email = `spike-${tag}-${run}@ember.test`;
  await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: admin },
    body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: `Spike ${tag}`, verified: true }) });
  return fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
    .then((r) => r.json());
}

const pbDate = (ms) => new Date(ms).toISOString().replace('T', ' ');
const createPrank = (target) =>
  fetch(`${PB_URL}/api/collections/pranks/records`, { method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: admin },
    body: JSON.stringify({ target, kind: 'ping', status: 'pending', params: {}, expires_at: pbDate(Date.now() + 45_000) }) })
    .then((r) => r.json());

const me = await member('target');
const other = await member('other');

/** One attempt: open the stream with the given Accept-Encoding, subscribe,
 *  create the two rows, and report what arrived. */
async function attempt(acceptEncoding) {
  const abort = new AbortController();
  const stream = await fetch(`${APP_URL}/pb/api/realtime`, { signal: abort.signal, headers: { accept: 'text/event-stream', 'accept-encoding': acceptEncoding } });
  console.log(`[${acceptEncoding}] GET /pb/api/realtime -> ${stream.status} ${stream.headers.get('content-type')} ${stream.headers.get('content-encoding') ?? 'uncompressed'}`);

  const events = [];
  let clientId = null;
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ done: true }));
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const name = /^event:(.*)$/m.exec(block)?.[1]?.trim();
        const data = /^data:(.*)$/m.exec(block)?.[1]?.trim();
        if (name === 'PB_CONNECT') clientId = JSON.parse(data).clientId;
        else if (name) events.push({ at: Date.now(), name, data: JSON.parse(data) });
      }
    }
  })();

  const waitFor = async (fn, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (fn()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return false;
  };

  const connected = await waitFor(() => clientId !== null, 5000);
  console.log(`PB_CONNECT through the rewrite: ${connected ? clientId : 'never arrived'}`);

  let pass = false;
  if (connected) {
    const options = { query: { filter: `target = "${me.record.id}" && status = "pending"` }, headers: {} };
    const sub = await fetch(`${APP_URL}/pb/api/realtime`, { method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: me.token },
      body: JSON.stringify({ clientId, subscriptions: [`pranks/*?options=${encodeURIComponent(JSON.stringify(options))}`] }) });
    console.log(`POST /pb/api/realtime (subscribe) -> ${sub.status}`);

    const sentAt = Date.now();
    const mine = await createPrank(me.record.id);
    const theirs = await createPrank(other.record.id);
    const got = await waitFor(() => events.some((e) => e.data?.record?.id === mine.id), 2000);
    const latency = got ? events.find((e) => e.data.record.id === mine.id).at - sentAt : null;
    await new Promise((r) => setTimeout(r, 500));
    const leaked = events.some((e) => e.data?.record?.id === theirs.id);
    console.log(`own row event: ${got ? `${latency} ms` : 'not within 2 s'}; other user's row leaked: ${leaked}`);
    pass = got && !leaked;
  }

  abort.abort();
  await pump.catch(() => {});
  return pass;
}

// A browser always offers gzip, and `next start` compresses (and so buffers)
// whatever the rewrite proxies, text/event-stream included. The identity run
// shows the stream itself is fine; the gzip run is what a browser gets.
const browserLike = await attempt('gzip, deflate, br');
const identity = await attempt('identity');
console.log(browserLike
  ? 'SPIKE PASS: SSE streams through /pb for a browser'
  : `SPIKE FAIL for a browser (identity encoding ${identity ? 'streams' : 'fails too'}): poll is the primary path`);
process.exit(browserLike ? 0 : 1);
