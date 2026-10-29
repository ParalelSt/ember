#!/usr/bin/env node
/** A test copy of Ember for any branch, with its own data.
 *
 *    npm run sandbox                       start this branch on a free port
 *    npm run sandbox -- ui/info-changes    start another branch
 *    npm run sandbox -- start --port 3072  a chosen port
 *    npm run sandbox -- list               what is running
 *    npm run sandbox -- stop 3072          stop one (or: stop all)
 *
 *  Always safe: never port 3000 or 8090 (your live Ember), never the live
 *  pocketbase/pb_data, and bug reports and requests go to a local sink
 *  (never to Discord). The sandbox PocketBase (port 8088, data in
 *  spotify-clone-wt/_sandbox/pb_data) is started when it is not running.
 *  Login for the sandbox admin comes from ~/.ember-tools/sandbox.env. */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { SANDBOX_PB_PORT, isLivePbData, pickFreePort, sandboxPortProblem } from './logic.mjs';
import {
  MAIN,
  ROOT,
  SANDBOX,
  cwdOf,
  fail,
  git,
  lanIp,
  listeningPorts,
  parseArgs,
  pidOnPort,
  sandboxEnv,
  say,
  worktrees,
} from './lib.mjs';

const { flags, rest } = parseArgs(process.argv.slice(2));
const verbs = ['start', 'stop', 'list'];
const verb = verbs.includes(rest[0]) ? rest.shift() : 'start';


/** Running sandboxes: every app port 3001-3999 (not 3000) whose process
 *  runs inside a worktree. */
function running() {
  const list = [];
  for (const port of listeningPorts().filter((p) => p > 3000 && p < 4000).sort()) {
    const pid = pidOnPort(port);
    const cwd = pid ? cwdOf(pid) : null;
    if (!cwd || !cwd.includes('spotify-clone-wt')) continue;
    const top = cwd.replace(/\/apps\/web$/, '');
    let branch = '?';
    try {
      branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], top);
    } catch {}
    list.push({ port, pid, branch, dir: top });
  }
  return list;
}

function list() {
  const apps = running();
  const pb = pidOnPort(SANDBOX_PB_PORT);
  if (!apps.length) say('No sandboxes running.');
  for (const a of apps) say(`${a.port}  ${a.branch}  http://${lanIp()}:${a.port}  (${a.dir})`);
  say(`PocketBase ${SANDBOX_PB_PORT}: ${pb ? 'running' : 'stopped'}`);
}

function stop(which) {
  const apps = running();
  const targets = which === 'all' ? apps : apps.filter((a) => String(a.port) === which || a.branch === which);
  if (!targets.length) fail(`No sandbox matches "${which}". Running: ${apps.map((a) => a.port).join(', ') || 'none'}`);
  for (const a of targets) {
    if (sandboxPortProblem(a.port)) continue;
    process.kill(a.pid, 'SIGTERM');
    say(`✓ stopped ${a.port} (${a.branch})`);
  }
}

function startPocketBase(dir) {
  if (pidOnPort(SANDBOX_PB_PORT)) return;
  const data = path.join(SANDBOX, 'pb_data');
  if (isLivePbData(data, MAIN)) fail('Refusing: that is the live pb_data.');
  const log = fs.openSync(path.join(SANDBOX, 'pb-sandbox.log'), 'a');
  spawn(
    path.join(MAIN, 'pocketbase/pocketbase'),
    [
      'serve',
      `--http=127.0.0.1:${SANDBOX_PB_PORT}`,
      `--dir=${data}`,
      `--hooksDir=${path.join(dir, 'pocketbase/pb_hooks')}`,
      `--migrationsDir=${path.join(dir, 'pocketbase/pb_migrations')}`,
      '--automigrate=0',
    ],
    { detached: true, stdio: ['ignore', log, log], cwd: SANDBOX },
  ).unref();
  say(`✓ sandbox PocketBase on ${SANDBOX_PB_PORT}`);
}

async function start() {
  const branch = rest[0] ?? git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const dir = branch === git(['rev-parse', '--abbrev-ref', 'HEAD']) ? ROOT : worktrees()[branch];
  if (!dir) fail(`No folder has ${branch} checked out. Make one: npm run branch -- ${branch} --from ${branch}`);

  const already = running().find((a) => a.dir === dir);
  if (already) return say(`Already running: ${already.port}  http://${lanIp()}:${already.port}`);

  const port = flags.port ? Number(flags.port) : pickFreePort(listeningPorts());
  const problem = sandboxPortProblem(port);
  if (problem) fail(problem);
  if (pidOnPort(port)) fail(`Port ${port} is taken. Leave out --port to get a free one.`);

  const env = sandboxEnv();
  if (!env.POCKETBASE_ADMIN_EMAIL || !env.POCKETBASE_ADMIN_PASSWORD) {
    fail('Put POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD of the sandbox in ~/.ember-tools/sandbox.env');
  }
  startPocketBase(dir);

  const ip = lanIp();
  const sink = 'http://127.0.0.1:8099';
  const log = path.join(SANDBOX, `app-${port}.log`);
  const out = fs.openSync(log, 'w');
  // A production build, like the 3072 copy: Next 16's dev server refuses its
  // own scripts to any origin but localhost, so a phone on the LAN got a
  // page that never loaded. webpack, because Turbopack cannot follow the
  // worktree's symlinked node_modules.
  spawn('sh', ['-c', `npx next build --webpack && exec npx next start -p ${port}`], {
    cwd: path.join(dir, 'apps/web'),
    detached: true,
    stdio: ['ignore', out, out],
    env: {
      ...process.env,
      POCKETBASE_URL: `http://127.0.0.1:${SANDBOX_PB_PORT}`,
      POCKETBASE_ADMIN_EMAIL: env.POCKETBASE_ADMIN_EMAIL,
      POCKETBASE_ADMIN_PASSWORD: env.POCKETBASE_ADMIN_PASSWORD,
      // --origin https://x.trycloudflare.com when the copy is reached through a tunnel.
      PUBLIC_ORIGIN: typeof flags.origin === 'string' ? flags.origin : `http://${ip}:${port}`,
      // Reports and requests never reach Discord from a sandbox.
      DISCORD_BUG_REPORT_WEBHOOK_URL: `${sink}/bug`,
      DISCORD_FEATURE_WEBHOOK_URL: `${sink}/feature`,
      DISCORD_FIX_WEBHOOK_URL: `${sink}/fix`,
      GITHUB_API_BASE: sink,
      GITHUB_RELEASES_TOKEN: 'sandbox-fake',
      YTDLP_AUTO_UPGRADE: '0',
      PYTHON_BIN: path.join(MAIN, '.venv/bin/python'),
      MUSIC_DIR: path.join(SANDBOX, 'music'),
    },
  }).unref();

  // Ready when the page answers (the build takes a few minutes).
  for (let i = 0; i < 450; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/login`, { redirect: 'manual' });
      if (res.status < 500) return say(`✓ ${branch} on http://${ip}:${port}  (log: ${log})`);
    } catch {}
  }
  fail(`Started, but nothing answers on ${port} after 15 minutes. Log: ${log}`);
}

if (verb === 'list') list();
else if (verb === 'stop') stop(rest[0] ?? 'all');
else await start();
