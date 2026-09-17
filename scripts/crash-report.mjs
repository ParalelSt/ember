#!/usr/bin/env node
/** Posts one crash event to Discord. Called by start-static.sh's watchdog and
 *  by the Next server's uncaught-error handler (lib/crashHandlers.ts).
 *
 *      node scripts/crash-report.mjs --title "..." --text "..." [--log path --lines 50]
 *
 *  No dependencies on purpose: it has to work when the thing that just crashed
 *  is the app itself, or node_modules is half-installed mid-update.
 *
 *  It never throws and always exits 0. The watchdog runs it in the background
 *  after a crash; a Discord outage must never turn into a second failure.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

export const RATE_LIMIT = 10;
export const RATE_WINDOW_MS = 60 * 60 * 1000;
const POST_TIMEOUT_MS = 10_000;
const TITLE_MAX = 256;
const DESCRIPTION_MAX = 4000;

// ── webhook resolution ────────────────────────────────────────────────────

/** Minimal .env parser: KEY=value lines, quotes and CR stripped. Only used to
 *  pick out a webhook URL, so nothing is ever exported into process.env. */
export function readEnvFile(file) {
  const out = {};
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    out[key] = value;
  }
  return out;
}

/** The bug-report route keeps the owner's webhook as a literal in source. It
 *  is read from that file at runtime rather than copied here, so there is one
 *  place to rotate it. */
export function extractDefaultWebhook(routeFile) {
  try {
    const src = fs.readFileSync(routeFile, 'utf8');
    const m = src.match(/const\s+DEFAULT_WEBHOOK_URL\s*=\s*["'`]([^"'`\s]+)["'`]/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

/** Order: crash webhook, then bug-report webhook, from the process env, then
 *  the same two from apps/web/.env.local (the watchdog does not load that file
 *  into its env), then the bug-report route's built-in default. */
export function resolveWebhook({
  env = process.env,
  envFile = path.join(ROOT, 'apps/web/.env.local'),
  routeFile = path.join(ROOT, 'apps/web/app/api/bug-report/route.ts'),
} = {}) {
  if (env.DISCORD_CRASH_WEBHOOK_URL) return env.DISCORD_CRASH_WEBHOOK_URL;
  if (env.DISCORD_BUG_REPORT_WEBHOOK_URL) return env.DISCORD_BUG_REPORT_WEBHOOK_URL;
  const fileEnv = readEnvFile(envFile);
  if (fileEnv.DISCORD_CRASH_WEBHOOK_URL) return fileEnv.DISCORD_CRASH_WEBHOOK_URL;
  if (fileEnv.DISCORD_BUG_REPORT_WEBHOOK_URL) return fileEnv.DISCORD_BUG_REPORT_WEBHOOK_URL;
  return extractDefaultWebhook(routeFile);
}

// ── scrubbing ─────────────────────────────────────────────────────────────

// Duplicated from scrubText in apps/web/lib/logger/sanitize.ts (this script
// cannot import TypeScript). Keep the two lists in step when either changes.
const SCRUB_PATTERNS = [
  [/\bbearer\s+[A-Za-z0-9\-_.]{8,}/gi, 'bearer [scrubbed]'],
  [/\b(cookie|set-cookie)\s*:\s*\S[^\n\r]*/gi, (_m, name) => `${name}: [scrubbed]`],
  [/\bpb_auth=[^;\s]+/gi, 'pb_auth=[scrubbed]'],
  [/([?&][^\s?&]*?[A-Za-z0-9_]+=)[^\s&]+/g, '$1[scrubbed]'],
  [/\b[0-9a-f]{32,}\b/gi, '[scrubbed]'],
  [/\b(?=[A-Za-z0-9+/]{40,}(?:=|\b))[A-Za-z0-9+/]{40,}={0,2}\b/g, '[scrubbed]'],
];

export function scrubText(text) {
  return text
    .split('\n')
    .map((line) => SCRUB_PATTERNS.reduce((out, [re, rep]) => out.replace(re, rep), line))
    .join('\n');
}

// ── log tail ──────────────────────────────────────────────────────────────

/** Last `lines` lines of a file, reading at most the final 256 KB so a large
 *  log never gets loaded whole. */
export function tailFile(file, lines) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const all = buf.toString('utf8').split('\n');
    if (all.length && all[all.length - 1] === '') all.pop();
    return all.slice(-lines).join('\n');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// ── rate limit ────────────────────────────────────────────────────────────

/** Decides whether this post may go out, and records it. Returns 'post',
 *  'mute-notice' (the one "muted for this hour" message) or 'silent'.
 *  The state file is shared by every concurrent poster (a crash loop fires
 *  several at once), so the read-modify-write happens under a lock file. */
export function takeRateSlot(stateFile, now = Date.now()) {
  const lockFile = `${stateFile}.lock`;
  const locked = acquireLock(lockFile);
  try {
    let state = { posts: [], mutedAt: 0 };
    try {
      const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (Array.isArray(parsed.posts)) state.posts = parsed.posts.filter((t) => typeof t === 'number');
      if (typeof parsed.mutedAt === 'number') state.mutedAt = parsed.mutedAt;
    } catch {
      // Missing or corrupt: start fresh.
    }
    state.posts = state.posts.filter((t) => now - t < RATE_WINDOW_MS);
    let decision;
    if (state.posts.length < RATE_LIMIT) {
      state.posts.push(now);
      decision = 'post';
    } else if (!state.mutedAt || now - state.mutedAt >= RATE_WINDOW_MS) {
      state.mutedAt = now;
      decision = 'mute-notice';
    } else {
      decision = 'silent';
    }
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state));
    return decision;
  } finally {
    if (locked) fs.rmSync(lockFile, { force: true });
  }
}

function acquireLock(lockFile) {
  const deadline = Date.now() + 3000;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  for (;;) {
    try {
      fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      // A poster killed mid-write leaves its lock behind; ignore one older
      // than a few seconds rather than muting reports forever.
      try {
        if (Date.now() - fs.statSync(lockFile).mtimeMs > 5000) fs.rmSync(lockFile, { force: true });
      } catch {
        // Gone already.
      }
      if (Date.now() > deadline) return false;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

// ── posting ───────────────────────────────────────────────────────────────

function gitShortSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

export function buildForm({ title, text, logTail, logName = 'log.txt', now = new Date() }) {
  const embed = {
    title: title.slice(0, TITLE_MAX),
    description: scrubText(text).slice(0, DESCRIPTION_MAX),
    color: 0xef4444,
    footer: { text: `${os.hostname()} · ${gitShortSha()} · ${now.toISOString()}` },
  };
  const form = new FormData();
  // Nothing in a crash message should ever ping anyone.
  form.append('payload_json', JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }));
  if (logTail) {
    form.append('files[0]', new Blob([scrubText(logTail)], { type: 'text/plain' }), logName);
  }
  return form;
}

export function parseArgs(argv) {
  const args = { title: '', text: '', log: '', lines: 50 };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--title') args.title = value ?? '';
    else if (key === '--text') args.text = value ?? '';
    else if (key === '--log') args.log = value ?? '';
    else if (key === '--lines') args.lines = Math.max(1, Number.parseInt(value, 10) || 50);
    else continue;
    i++;
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const webhook = resolveWebhook();
    if (!webhook) {
      console.error('crash-report: no Discord webhook configured, not posted');
      return;
    }
    const logDir = process.env.EMBER_LOG_DIR || path.join(ROOT, 'logs');
    const decision = takeRateSlot(path.join(logDir, 'crash-report.state'));
    if (decision === 'silent') return;

    let form;
    if (decision === 'mute-notice') {
      form = buildForm({
        title: 'Ember: too many crash reports',
        text: `too many crash reports, muted for this hour (more than ${RATE_LIMIT} in the last hour). Check logs/ on the host.`,
      });
    } else {
      const logTail = args.log ? tailFile(args.log, args.lines) : '';
      form = buildForm({
        title: args.title || 'Ember crash',
        text: args.text || '(no details)',
        logTail,
        logName: args.log ? `${path.basename(args.log)}.txt` : 'log.txt',
      });
    }
    const res = await fetch(webhook, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`crash-report: Discord answered ${res.status}, not posted`);
    }
  } catch (e) {
    console.error(`crash-report: post failed (${e instanceof Error ? e.message : String(e)})`);
  }
}

// Tests import this file for its functions; only a direct `node` run posts.
function invokedDirectly() {
  try {
    return fs.realpathSync(path.resolve(process.argv[1] ?? '')) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (invokedDirectly()) {
  await main();
  process.exit(0);
}
