import 'server-only';
// Minimal Discord IPC client. No third-party dep — Discord's IPC protocol is
// just length-prefixed JSON over a Unix socket. Idle no-op if DISCORD_APP_ID
// is unset. Lazily connects on first updateDiscordActivity().
import { createConnection, type Socket } from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Track } from '@/types/track';

const APP_ID = process.env.DISCORD_APP_ID;
const RATE_LIMIT_MS = 15000;
const RECONNECT_MS = 30000;

let socket: Socket | null = null;
let connected = false;
let lastUpdate = 0;
let pendingActivity: Record<string, unknown> | null | undefined = undefined;
let updateTimer: NodeJS.Timeout | null = null;
let connectTimer: NodeJS.Timeout | null = null;
let initialized = false;

function ipcCandidatePaths(): string[] {
  const bases = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, '/tmp'].filter(Boolean) as string[];
  const paths: string[] = [];
  for (const b of bases) {
    for (let i = 0; i < 10; i++) paths.push(path.join(b, `discord-ipc-${i}`));
    for (let i = 0; i < 10; i++) paths.push(path.join(b, 'app/com.discordapp.Discord', `discord-ipc-${i}`));
  }
  return paths;
}

function tryConnect(paths: string[]): Promise<Socket> {
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

function frame(op: number, payload: unknown): Buffer {
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
      scheduleReconnect();
    });
    socket.on('error', () => { /* close handler reconnects */ });
    socket.on('data', () => { /* drain */ });
    socket.write(frame(0, { v: 1, client_id: APP_ID }));
    connected = true;
    if (pendingActivity !== undefined && !updateTimer) flushActivity();
  } catch {
    scheduleReconnect();
  }
}

function flushActivity() {
  updateTimer = null;
  if (pendingActivity === undefined) return;
  if (!connected || !socket) return;
  const activity = pendingActivity;
  pendingActivity = undefined;
  const msg = { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: randomUUID() };
  try {
    socket.write(frame(1, msg));
    lastUpdate = Date.now();
  } catch {
    connected = false;
    pendingActivity = activity;
    scheduleReconnect();
  }
}

function setActivity(activity: Record<string, unknown> | null) {
  pendingActivity = activity;
  if (updateTimer) return;
  const wait = Math.max(0, RATE_LIMIT_MS - (Date.now() - lastUpdate));
  updateTimer = setTimeout(flushActivity, wait);
}

function trim(s: string | undefined | null, n: number): string | undefined {
  return typeof s === 'string' ? s.slice(0, n) : undefined;
}

function ensureInit() {
  if (initialized || !APP_ID) return;
  initialized = true;
  connect();
}

export function updateDiscordActivity(track: Track | null, isPlaying: boolean) {
  if (!APP_ID) return;
  ensureInit();
  if (!track || !isPlaying) {
    setActivity(null);
    return;
  }
  setActivity({
    type: 0,
    details: trim(track.title, 128),
    state: track.artist ? trim(`by ${track.artist}`, 128) : undefined,
    timestamps: { start: Date.now() },
    assets: {
      large_image: track.artworkUrl ?? undefined,
      large_text: trim(track.album ?? track.title, 128),
    },
  });
}

export function clearDiscordActivity() {
  if (!APP_ID) return;
  ensureInit();
  setActivity(null);
}
