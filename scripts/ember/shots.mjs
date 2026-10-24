#!/usr/bin/env node
/** Screenshots of Ember pages from a running sandbox, phone and desktop.
 *
 *    npm run shots -- /library /settings          both sizes, port 3072
 *    npm run shots -- /library --port 3050 --phone
 *    npm run shots -- / --desktop --full          the whole page, scrolled
 *
 *  Signed in as the screenshot account from ~/.ember-tools/sandbox.env
 *  (SHOTS_EMAIL / SHOTS_PASSWORD). Without one, a "shots@ember.test" account
 *  is made in the sandbox PocketBase (never the live one) and saved there.
 *  Pictures go to .shots/<time>/ (git ignores it); the paths are printed. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SANDBOX_PB_PORT, sandboxPortProblem } from './logic.mjs';
import { ROOT, TOOLS_DIR, fail, parseArgs, sandboxEnv, say } from './lib.mjs';

const { flags, rest } = parseArgs(process.argv.slice(2));
const routes = rest.length ? rest : ['/'];
const port = Number(flags.port ?? 3072);
const problem = sandboxPortProblem(port);
if (problem) fail(problem);
const sizes = [
  ...(flags.desktop || !flags.phone ? [['desktop', { width: 1280, height: 800 }]] : []),
  ...(flags.phone || !flags.desktop ? [['phone', { width: 390, height: 844 }]] : []),
];

const PB = `http://127.0.0.1:${SANDBOX_PB_PORT}`;
async function pb(pathname, body, token) {
  const res = await fetch(`${PB}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

/** The screenshot account's login, made once in the sandbox if needed. */
async function account() {
  const env = sandboxEnv();
  if (env.SHOTS_EMAIL && env.SHOTS_PASSWORD) return { email: env.SHOTS_EMAIL, password: env.SHOTS_PASSWORD };
  const admin = await pb('/api/admins/auth-with-password', { identity: env.POCKETBASE_ADMIN_EMAIL, password: env.POCKETBASE_ADMIN_PASSWORD });
  if (!admin.ok) fail('Cannot sign in to the sandbox PocketBase as admin (check ~/.ember-tools/sandbox.env, and npm run sandbox).');
  const email = 'shots@ember.test';
  const password = crypto.randomBytes(12).toString('base64url');
  const made = await pb('/api/collections/users/records', { email, password, passwordConfirm: password, name: 'Shots', verified: true }, admin.json.token);
  if (!made.ok) fail(`Could not make ${email} in the sandbox: ${JSON.stringify(made.json).slice(0, 200)}`);
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  fs.appendFileSync(path.join(TOOLS_DIR, 'sandbox.env'), `\nSHOTS_EMAIL=${email}\nSHOTS_PASSWORD=${password}\n`);
  say(`Made the screenshot account ${email} in the sandbox.`);
  return { email, password };
}

const { email, password } = await account();
const auth = await pb('/api/collections/users/auth-with-password', { identity: email, password });
if (!auth.ok) fail(`Sign-in as ${email} failed in the sandbox.`);

const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = require('playwright-core');
const browser = await chromium.launch();
const out = path.join(ROOT, '.shots', new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'));
fs.mkdirSync(out, { recursive: true });
// localhost, not 127.0.0.1: the dev server only trusts the first.
const base = `http://localhost:${port}`;
const cookie = { name: 'pb_auth', value: encodeURIComponent(JSON.stringify({ token: auth.json.token, model: auth.json.record })), url: base };

try {
  for (const [label, viewport] of sizes) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: label === 'phone', hasTouch: label === 'phone' });
    await context.addCookies([cookie]);
    const page = await context.newPage();
    for (const route of routes) {
      await page.goto(base + route, { waitUntil: 'networkidle', timeout: 90_000 }).catch(() => {});
      await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {});
      await page.waitForTimeout(1200);
      const name = `${route.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'home'}-${label}.png`;
      await page.screenshot({ path: path.join(out, name), fullPage: !!flags.full });
      say(path.join(out, name));
    }
    await context.close();
  }
} finally {
  await browser.close();
}
