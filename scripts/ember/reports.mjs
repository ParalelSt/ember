#!/usr/bin/env node
/** What people sent in the Ember Discord since the last time you looked.
 *
 *    npm run reports                    new since last run, then marks them seen
 *    npm run reports -- --since 2026-10-17   everything since that day
 *    npm run reports -- --peek          show new ones, keep them unseen
 *    npm run reports -- --digests       include the daily error digests
 *
 *  Prints one short line per message and saves the full text to
 *  docs/reports/discord-<date>.md (git ignores that folder). Read by the Ember
 *  bot; its token stays in ~/.claude/channels/discord/.env. */

import fs from 'node:fs';
import path from 'node:path';
import { isDigest, messageHeadline, messageLine } from './logic.mjs';
import { EMBER_CHANNELS, MAIN, TOOLS_DIR, discord, parseArgs, say } from './lib.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const stateFile = path.join(TOOLS_DIR, 'reports-state.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};

// A Discord id is a timestamp: build the smallest id of a given day.
const idForDate = (d) => String((BigInt(Date.parse(`${d}T00:00:00Z`)) - 1420070400000n) << 22n);
const since = flags.since ? idForDate(flags.since) : null;

const today = new Date().toISOString().slice(0, 10);
const full = [`# Ember Discord, read ${new Date().toISOString().slice(0, 16)}`];
let total = 0;

for (const [name, id] of Object.entries(EMBER_CHANNELS)) {
  // First run without --since: the last 7 days.
  let after = since ?? state[id] ?? idForDate(new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10));
  const messages = [];
  for (;;) {
    const page = await discord(`/channels/${id}/messages?limit=100&after=${after}`);
    if (!page.length) break;
    page.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    messages.push(...page);
    after = page[page.length - 1].id;
    if (page.length < 100) break;
  }
  if (messages.length) state[id] = messages[messages.length - 1].id;
  const shown = flags.digests ? messages : messages.filter((m) => !isDigest(m));
  if (!shown.length) continue;
  total += shown.length;
  say(`\n${name} (${shown.length})`);
  for (const m of shown) say(`  ${m.timestamp.slice(5, 16).replace('T', ' ')}  ${messageHeadline(m)}`);
  full.push(`\n# ${name}`, ...shown.map(messageLine));
}

if (!total) say('Nothing new.');
else {
  const dir = path.join(MAIN, 'docs/reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `discord-${today}.md`);
  fs.appendFileSync(file, `${full.join('\n')}\n`);
  say(`\nFull text: ${file}`);
}
if (!flags.peek) {
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}
