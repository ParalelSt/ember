#!/usr/bin/env node
/** npm run perf [-- <session>] [--user <id or email>] [--days N] [--host URL] [--json]
 *
 *  Every member's app performance, from the host's perf store (POST
 *  /api/perf-log, read back through the admin-only GET /api/admin/perf).
 *  Without a session: one line per page session of the last 7 days, newest
 *  first. With one: that session's timeline, a line per 5 min digest.
 *
 *  Signs in as an admin with PERF_ADMIN_EMAIL / PERF_ADMIN_PASSWORD (or
 *  EMBER_ADMIN_EMAIL / EMBER_ADMIN_PASSWORD), from the environment or
 *  ~/.ember-tools/sandbox.env. The host is --host, else EMBER_HOST_URL
 *  there, else the usual tailnet address. */

import path from 'node:path';
import { fail, parseArgs, readEnvFile, say, TOOLS_DIR } from './lib.mjs';
import { adminCookie, formatSessions, formatTimeline, perfQuery } from './perfLogic.mjs';

const { flags, rest } = parseArgs(process.argv.slice(2));
const env = { ...readEnvFile(path.join(TOOLS_DIR, 'sandbox.env')), ...process.env };
const host = String(flags.host ?? env.EMBER_HOST_URL ?? 'https://ember.tailf4de41.ts.net').replace(/\/$/, '');
const email = env.PERF_ADMIN_EMAIL ?? env.EMBER_ADMIN_EMAIL;
const password = env.PERF_ADMIN_PASSWORD ?? env.EMBER_ADMIN_PASSWORD;
if (!email || !password) fail('Set PERF_ADMIN_EMAIL and PERF_ADMIN_PASSWORD (an admin account) in ~/.ember-tools/sandbox.env.');

async function call(url, init) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    fail(`${host} does not answer (${e.message}). Is it on, and is this Mac on the tailnet?`);
  }
}

const signIn = await call(`${host}/pb/api/collections/users/auth-with-password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: email, password }),
});
if (!signIn.ok) fail(`Sign-in as ${email} on ${host} failed (${signIn.status}).`);
const { token, record } = await signIn.json();
const cookie = adminCookie(token, record);

const session = rest[0];
const user = typeof flags.user === 'string' ? flags.user : undefined;
const days = flags.days ? Number(flags.days) : undefined;
const res = await call(`${host}/api/admin/perf${perfQuery({ session, user, days })}`, { headers: { cookie } });
if (res.status === 403) fail(`${email} is not an admin on ${host}.`);
if (res.status === 404) fail(`No perf session ${session} in that window.`);
if (!res.ok) fail(`The host answered ${res.status}.`);
const body = await res.json();

if (flags.json) {
  say(JSON.stringify(body, null, 2));
} else if (session) {
  for (const line of formatTimeline(body.session, body.timeline)) say(line);
} else {
  const sessions = user?.includes('@') ? body.sessions.filter((s) => s.email === user) : body.sessions;
  for (const line of formatSessions(sessions)) say(line);
}
