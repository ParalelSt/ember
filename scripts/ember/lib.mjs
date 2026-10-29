/** What every Ember tool shares: where things are, running commands,
 *  asking (only when a person is at the terminal) and the Discord bot. */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

/** This checkout (a worktree or the main one). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** The main checkout, where node_modules and .venv really live. */
export const MAIN = path.resolve(
  ROOT,
  execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim(),
  '..',
);
/** Where worktrees go: spotify-clone-wt next to the main checkout. */
export const WT = path.join(path.dirname(MAIN), 'spotify-clone-wt');
/** Sandbox data and logs, outside every checkout. */
export const SANDBOX = path.join(WT, '_sandbox');
/** Local settings of these tools (never in git): sandbox.env etc. */
export const TOOLS_DIR = path.join(os.homedir(), '.ember-tools');

export const say = (s = '') => console.log(s);
export function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

export function git(args, cwd = ROOT) {
  // A big merge's diff runs to tens of MB; the 1MB default made the pre-push
  // scan crash (ENOBUFS) instead of checking it.
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024 }).trim();
}
export function tryGit(args, cwd = ROOT) {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}
export function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
}

/** `--flag value` and `--flag` out of argv; the rest are positional. */
export function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) rest.push(a);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = true;
  }
  return { flags, rest };
}

export const interactive = () => process.stdin.isTTY && process.stdout.isTTY;

/** Ask a person; with nobody at the terminal, use the default (or stop
 *  when there is none, naming the flag that answers it). */
export async function ask(question, { fallback, flag } = {}) {
  if (!interactive()) {
    if (fallback !== undefined) return fallback;
    fail(`${question} (nobody to ask: pass ${flag ?? 'it as an argument'})`);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} `)).trim();
  rl.close();
  return answer || fallback || '';
}

/** Yes/no; `--yes` answers yes, nobody at the terminal answers no. */
export async function confirm(question, flags) {
  if (flags?.yes) return true;
  if (!interactive()) return false;
  return /^y(es)?$/i.test(await ask(`${question} [y/N]`, { fallback: 'n' }));
}

/** KEY=value lines from a file, or {} when it is missing. */
export function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Sandbox settings: admin login of the sandbox PocketBase, the account
 *  screenshots use. Lives in ~/.ember-tools/sandbox.env. */
export const sandboxEnv = () => readEnvFile(path.join(TOOLS_DIR, 'sandbox.env'));

export const OWNER_DM_CHANNEL = '1560344989651959839';
export const EMBER_CHANNELS = {
  'bug-reports': '1512120804501098578',
  recommendations: '1550133811684057188',
  'fix-recommendations': '1550133837160259606',
  suggestions: '1556757335043612752',
  ideas: '1557044378747281458',
  'info-for-changes': '1560258394697375826',
};

/** The Ember bot's token, never printed. */
export function botToken() {
  const env = readEnvFile(path.join(os.homedir(), '.claude/channels/discord/.env'));
  const token = env.DISCORD_BOT_TOKEN ?? env.DISCORD_TOKEN;
  if (!token) fail('No Discord bot token in ~/.claude/channels/discord/.env');
  return token;
}

export async function discord(pathname, init = {}) {
  const res = await fetch(`https://discord.com/api/v10${pathname}`, {
    ...init,
    headers: { Authorization: `Bot ${botToken()}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) fail(`Discord said ${res.status} for ${pathname}`);
  return res.status === 204 ? null : res.json();
}

/** Every port something on this Mac listens on. */
export function listeningPorts() {
  const out = sh('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fn']).stdout ?? '';
  return [...new Set([...out.matchAll(/:(\d+)$/gm)].map((m) => Number(m[1])))];
}

/** The pid listening on `port`, or null. */
export function pidOnPort(port) {
  const out = (sh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).stdout ?? '').trim();
  return out ? Number(out.split('\n')[0]) : null;
}

/** The folder a process runs in. */
export function cwdOf(pid) {
  const out = sh('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).stdout ?? '';
  return /^n(.*)$/m.exec(out)?.[1] ?? null;
}

/** branch -> worktree folder, for every worktree. */
export function worktrees() {
  const out = git(['worktree', 'list', '--porcelain']);
  const map = {};
  let dir = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) dir = line.slice(9);
    if (line.startsWith('branch refs/heads/')) map[line.slice(18)] = dir;
  }
  return map;
}

/** Link node_modules into a worktree (never npm install in one). */
export function linkNodeModules(dir) {
  for (const sub of ['', 'apps/web/', 'apps/mobile/']) {
    const target = path.join(MAIN, sub, 'node_modules');
    const link = path.join(dir, sub, 'node_modules');
    if (fs.existsSync(target) && !fs.existsSync(link)) fs.symlinkSync(target, link);
  }
}

/** This Mac's address on the Wi-Fi, for links a phone can open. */
export function lanIp() {
  for (const nic of ['en0', 'en1']) {
    const ip = (sh('ipconfig', ['getifaddr', nic]).stdout ?? '').trim();
    if (ip) return ip;
  }
  return '127.0.0.1';
}
