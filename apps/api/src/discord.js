// Minimal Discord IPC client. No third-party dep — Discord's IPC protocol is
// just length-prefixed JSON over a Unix socket. This avoids the unmaintained
// `discord-rpc` npm package.
//
// Usage:
//   1. Register an app at https://discord.com/developers/applications
//   2. Set DISCORD_APP_ID in apps/api/.env
//   3. Restart the API. If DISCORD_APP_ID is unset, this module is a no-op.

import { createConnection } from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const APP_ID = process.env.DISCORD_APP_ID;
const RATE_LIMIT_MS = 15000;       // Discord caps activity updates at 1/15s
const RECONNECT_MS = 30000;

let socket = null;
let connected = false;
let lastUpdate = 0;
let pendingActivity = undefined;   // undefined = nothing queued; null = clear; object = set
let updateTimer = null;
let connectTimer = null;

function ipcCandidatePaths() {
  // Linux: $XDG_RUNTIME_DIR. macOS: $TMPDIR. Both: try -0 through -9.
  // (Flatpak/Snap installs may further nest under app/com.discordapp.Discord/.)
  const bases = [
    process.env.XDG_RUNTIME_DIR,
    process.env.TMPDIR,
    '/tmp',
  ].filter(Boolean);
  const paths = [];
  for (const b of bases) {
    for (let i = 0; i < 10; i++) paths.push(path.join(b, `discord-ipc-${i}`));
    // Common Flatpak nesting:
    for (let i = 0; i < 10; i++) paths.push(path.join(b, 'app/com.discordapp.Discord', `discord-ipc-${i}`));
  }
  return paths;
}

function tryConnect(paths) {
  return new Promise((resolve, reject) => {
    if (paths.length === 0) return reject(new Error('no Discord IPC socket found'));
    const [head, ...tail] = paths;
    const s = createConnection(head);
    let done = false;
    s.once('connect', () => { if (!done) { done = true; resolve(s); } });
    s.once('error', () => {
      if (done) return;
      done = true;
      s.destroy();
      tryConnect(tail).then(resolve, reject);
    });
  });
}

function frame(op, payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const buf = Buffer.alloc(8 + json.length);
  buf.writeInt32LE(op, 0);
  buf.writeInt32LE(json.length, 4);
  json.copy(buf, 8);
  return buf;
}

function scheduleReconnect() {
  if (connectTimer || !APP_ID) return;
  connectTimer = setTimeout(() => { connectTimer = null; connect(); }, RECONNECT_MS);
}

async function connect() {
  if (!APP_ID || connected) return;
  try {
    socket = await tryConnect(ipcCandidatePaths());
    socket.on('close', () => {
      connected = false;
      socket = null;
      console.log('[discord] socket closed; will retry');
      scheduleReconnect();
    });
    socket.on('error', () => { /* swallow; close handler reconnects */ });
    socket.on('data', () => { /* drain server frames; we don't need them */ });
    socket.write(frame(0, { v: 1, client_id: APP_ID }));
    connected = true;
    console.log('[discord] connected');
    // If something queued during the disconnected window, flush it now.
    if (pendingActivity !== undefined && !updateTimer) flushActivity();
  } catch (e) {
    console.log('[discord] connect failed:', e.message);
    scheduleReconnect();
  }
}

function flushActivity() {
  updateTimer = null;
  if (pendingActivity === undefined) return;
  if (!connected || !socket) {
    // Stay queued; reconnect path will flush.
    return;
  }
  const activity = pendingActivity;
  pendingActivity = undefined;
  const msg = {
    cmd: 'SET_ACTIVITY',
    args: { pid: process.pid, activity },
    nonce: randomUUID(),
  };
  try {
    socket.write(frame(1, msg));
    lastUpdate = Date.now();
  } catch (e) {
    console.log('[discord] write failed:', e.message);
    connected = false;
    pendingActivity = activity; // requeue
    scheduleReconnect();
  }
}

function setActivity(activity) {
  pendingActivity = activity;
  if (updateTimer) return;
  const wait = Math.max(0, RATE_LIMIT_MS - (Date.now() - lastUpdate));
  updateTimer = setTimeout(flushActivity, wait);
}

export function initDiscord() {
  if (!APP_ID) {
    console.log('[discord] DISCORD_APP_ID not set; rich presence disabled');
    return;
  }
  connect();
}

function trim(s, n) { return typeof s === 'string' ? s.slice(0, n) : undefined; }

export function updateDiscordActivity(track, isPlaying) {
  if (!APP_ID) return;
  if (!track || !isPlaying) {
    setActivity(null);
    return;
  }
  setActivity({
    type: 0, // "Playing" — Discord reserves "Listening" (type 2) for partner apps
    details: trim(track.title, 128),
    state: track.artist ? trim(`by ${track.artist}`, 128) : undefined,
    timestamps: { start: Date.now() },
    assets: {
      // Discord accepts some external URLs for large_image now; YT thumb URLs
      // are hit-or-miss. If you uploaded a custom asset in your Discord app,
      // use its key here instead (e.g. "ember-logo").
      large_image: track.artworkUrl,
      large_text: trim(track.album ?? track.title, 128),
    },
  });
}

export function clearDiscordActivity() {
  if (!APP_ID) return;
  setActivity(null);
}
