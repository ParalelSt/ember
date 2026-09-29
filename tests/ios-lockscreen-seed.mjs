/** Seeds a throwaway Ember server for the iPhone app's lock screen UI test
 *  (apps/mobile/ios/App/AppUITests/LockScreenControlsUITests.swift).
 *
 *      node tests/ios-lockscreen-seed.mjs
 *
 *  Makes a member (lock@ember.test / LockTest2026!, on the invite list) and
 *  three 20 second uploads, "Lock Alpha", "Lock Bravo" and "Lock Charlie",
 *  each a different tone with its own cover in the tag (red, green, blue),
 *  uploaded Charlie first so the Uploads list, newest first, plays them
 *  Alpha, Bravo, Charlie. Short songs, so the test sees a song end by itself
 *  within seconds. Safe to run again: whatever already exists is kept.
 *
 *  Needs ffmpeg on PATH and a sandbox server, never the live one:
 *    APP_URL            default http://127.0.0.1:3190
 *    PB_URL             default http://127.0.0.1:8218
 *    PB_ADMIN_EMAIL     default admin@ember.test
 *    PB_ADMIN_PASSWORD  the sandbox superuser's password (required) */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:3190';
const PB = process.env.PB_URL ?? 'http://127.0.0.1:8218';
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'admin@ember.test';
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;
const EMAIL = 'lock@ember.test';
const PASSWORD = 'LockTest2026!';
const SONGS = [
  { name: 'Charlie', hz: 659, color: 'blue' },
  { name: 'Bravo', hz: 554, color: 'green' },
  { name: 'Alpha', hz: 440, color: 'red' },
];

if (!ADMIN_PASSWORD) {
  console.error('set PB_ADMIN_PASSWORD to the sandbox superuser password');
  process.exit(2);
}

const json = (body) => ({ 'content-type': 'application/json', ...body });

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(PB + p, { method: 'POST', headers: json(), body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASSWORD }) });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error(`no superuser sign-in on ${PB}`);
}

async function ensureMember(admin) {
  const invite = await fetch(`${PB}/api/collections/allowed_emails/records`, {
    method: 'POST', headers: json({ Authorization: admin }), body: JSON.stringify({ email: EMAIL }),
  });
  if (!invite.ok && invite.status !== 400) throw new Error(`invite failed: ${invite.status}`);
  const created = await fetch(`${PB}/api/collections/users/records`, {
    method: 'POST', headers: json({ Authorization: admin }),
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Lock Tester', verified: true }),
  });
  if (!created.ok && created.status !== 400) throw new Error(`member failed: ${created.status}`);
  const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, {
    method: 'POST', headers: json(), body: JSON.stringify({ identity: EMAIL, password: PASSWORD }),
  }).then((r) => r.json());
  if (!auth.token) throw new Error('member sign-in failed (an older member with another password?)');
  return `pb_auth=${encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }))}`;
}

/** A 20 second mp3 of one tone with a one-colour cover in its ID3 tag. */
function makeSong(dir, { name, hz, color }) {
  const cover = path.join(dir, `${name}.jpg`);
  const song = path.join(dir, `${name}.mp3`);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:size=512x512`, '-frames:v', '1', cover]);
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=20`, '-i', cover,
    '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-b:a', '96k', '-id3v2_version', '3',
    '-c:v', 'mjpeg', '-disposition:v', 'attached_pic', song,
  ]);
  return song;
}

const cookie = await ensureMember(await adminToken());
const existing = await fetch(`${APP}/api/uploads`, { headers: { cookie } }).then((r) => r.json());
const have = new Set((existing.tracks ?? []).map((t) => t.title));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-lock-'));
try {
  for (const song of SONGS) {
    const title = `Lock ${song.name}`;
    if (have.has(title)) { console.log(`${title}: already there`); continue; }
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(makeSong(dir, song))], { type: 'audio/mpeg' }), `${song.name}.mp3`);
    form.append('title', title);
    form.append('artist', 'Ember Tester');
    form.append('album', 'Lock Screen Suite');
    form.append('durationSec', '20');
    const r = await fetch(`${APP}/api/uploads`, { method: 'POST', body: form, headers: { cookie } });
    if (!r.ok) throw new Error(`${title}: upload failed ${r.status} ${(await r.text()).slice(0, 200)}`);
    console.log(`${title}: uploaded`);
    // Newest first is by creation time: keep them a clear second apart.
    await new Promise((res) => setTimeout(res, 1100));
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`member ${EMAIL} / ${PASSWORD} is ready on ${APP}`);
