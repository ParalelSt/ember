#!/usr/bin/env node
/** One list of what was fixed, made and rejected, kept in the private
 *  Discord channel #tracker. Claude keeps it; the owner only reads it.
 *
 *    npm run tracker -- scan [--days 30]      messages not tracked yet
 *    npm run tracker -- seen <link|id>...     not worth tracking
 *    npm run tracker -- fixed|made|rejected <link> "summary" [--version 0.7.31] [--reason "..."]
 *    npm run tracker -- open <link> "summary" accepted, not done yet
 *    npm run tracker -- release 0.7.31        version on every fixed/made item without one
 *    npm run tracker -- post                  write the list to #tracker (edits in place)
 *    npm run tracker -- list                  show the list here
 *
 *  fixed/made/rejected/open/release post by themselves; --no-post skips it.
 *  A new item needs the full message link (right click, Copy Message Link);
 *  an id alone works for an item that is already tracked.
 *  State: ~/.ember-tools/tracker.json. Decisions: trackerLogic.mjs. */

import fs from 'node:fs';
import path from 'node:path';
import { EMBER_CHANNELS, TOOLS_DIR, botToken, discord, fail, parseArgs, say } from './lib.mjs';
import {
  STATUSES,
  emptyState,
  markSeen,
  messageLink,
  messageText,
  newMessages,
  normalizeState,
  parseTarget,
  renderTracker,
  splitMessages,
  stampRelease,
  upsertItem,
} from './trackerLogic.mjs';

const stateFile = path.join(TOOLS_DIR, 'tracker.json');
const loadState = () => (fs.existsSync(stateFile) ? normalizeState(JSON.parse(fs.readFileSync(stateFile, 'utf8'))) : emptyState());
function saveState(state) {
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  const tmp = `${stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, stateFile);
}

const channelNames = Object.fromEntries(Object.entries(EMBER_CHANNELS).map(([name, id]) => [id, name]));
const SOURCES = ['bug-reports', 'recommendations', 'fix-recommendations', 'suggestions', 'ideas'];

/** Discord call that reports instead of stopping the tool. */
async function api(method, pathname, body) {
  const res = await fetch(`https://discord.com/api/v10${pathname}`, {
    method,
    headers: { Authorization: `Bot ${botToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

async function findTrackerChannel() {
  const bug = await api('GET', `/channels/${EMBER_CHANNELS['bug-reports']}`);
  if (!bug.ok) return null;
  const list = await api('GET', `/guilds/${bug.data.guild_id}/channels`);
  if (!list.ok) return null;
  return list.data.find((c) => c.type === 0 && c.name === 'tracker')?.id ?? null;
}

async function post(state) {
  if (!state.channelId) {
    state.channelId = await findTrackerChannel();
    if (!state.channelId) {
      say('No #tracker channel exists yet. Create a private text channel named "tracker" (the bot needs access); the list is kept locally until then.');
      saveState(state);
      return;
    }
    saveState(state);
  }
  const chunks = splitMessages(renderTracker(state));
  const ids = [];
  for (let i = 0; i < chunks.length; i++) {
    const payload = { content: chunks[i], allowed_mentions: { parse: [] }, flags: 4 };
    let res = state.messageIds[i] ? await api('PATCH', `/channels/${state.channelId}/messages/${state.messageIds[i]}`, payload) : null;
    // The old message is gone (deleted by hand): make a new one.
    if (!res || res.status === 404) res = await api('POST', `/channels/${state.channelId}/messages`, payload);
    if (!res.ok) {
      say(`✗ Discord said ${res.status} writing the list to #tracker (is the bot allowed in it?). The local list is saved.`);
      return;
    }
    ids.push(res.data?.id ?? state.messageIds[i]);
  }
  for (const extra of state.messageIds.slice(chunks.length)) await api('DELETE', `/channels/${state.channelId}/messages/${extra}`);
  state.messageIds = ids;
  saveState(state);
  say(`✓ #tracker updated (${chunks.length} message${chunks.length > 1 ? 's' : ''})`);
}

async function guildId() {
  const bug = await discord(`/channels/${EMBER_CHANNELS['bug-reports']}`);
  return bug.guild_id;
}

async function scan(days) {
  const state = loadState();
  const cutoff = Date.now() - days * 864e5;
  const guild = await guildId();
  let shown = 0;
  for (const name of SOURCES) {
    const id = EMBER_CHANNELS[name];
    const messages = [];
    let before = '';
    for (;;) {
      const page = await discord(`/channels/${id}/messages?limit=100${before}`);
      if (!page.length) break;
      messages.push(...page.filter((m) => Date.parse(m.timestamp) >= cutoff));
      before = `&before=${page[page.length - 1].id}`;
      if (page.length < 100 || Date.parse(page[page.length - 1].timestamp) < cutoff) break;
    }
    for (const m of newMessages(messages, state)) {
      const text = messageText(m).slice(0, 120) || '(attachment only)';
      say(`${m.id.slice(-6)}  ${name}  ${m.author?.username ?? '?'}  ${m.timestamp.slice(0, 10)}`);
      say(`    ${text}`);
      say(`    ${messageLink(guild, id, m.id)}`);
      shown++;
    }
  }
  say(shown ? `\n${shown} not tracked yet.` : 'Nothing untracked.');
}

async function main() {
  const argv = process.argv.slice(2);
  const noPost = argv.includes('--no-post');
  const { flags, rest } = parseArgs(argv.filter((a) => a !== '--no-post'));
  const [command, ...args] = rest;
  const state = loadState();
  const done = async (next) => {
    saveState(next);
    if (!noPost) await post(next);
  };

  if (command === 'scan') return scan(Number(flags.days) > 0 ? Number(flags.days) : 30);
  if (command === 'list') return say(renderTracker(state));
  if (command === 'post') return post(state);

  if (command === 'seen') {
    const ids = args.map((a) => parseTarget(a)?.id).filter(Boolean);
    if (!ids.length) fail('Give message links or ids: tracker seen <link|id>...');
    saveState(markSeen(state, ids));
    return say(`✓ ${ids.length} marked as not worth tracking`);
  }

  if (command === 'release') {
    const version = args[0];
    if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) fail('Give a version: tracker release 0.7.31');
    const { state: next, count } = stampRelease(state, version);
    say(`✓ ${count} item${count === 1 ? '' : 's'} now in ${version}`);
    return done(next);
  }

  if (STATUSES.includes(command)) {
    const target = parseTarget(args[0]);
    const summary = args.slice(1).join(' ').trim();
    if (!target) fail(`Give the message link or id: tracker ${command} <link> "summary"`);
    const old = state.items.find((i) => i.id === target.id);
    if (!old && !target.channelId) fail('A new item needs the full message link (Copy Message Link in Discord).');
    if (!old && !summary) fail('Give a short summary after the link.');
    const item = {
      id: target.id,
      status: command,
      summary: summary || undefined,
      reason: typeof flags.reason === 'string' ? flags.reason : undefined,
      version: typeof flags.version === 'string' ? flags.version : undefined,
    };
    if (!old) {
      item.channel = channelNames[target.channelId] ?? 'unknown';
      item.link = messageLink(target.guild, target.channelId, target.id);
      item.at = new Date().toISOString();
    }
    say(`✓ ${command}: ${summary || old.summary}`);
    return done(upsertItem(state, item));
  }

  say('Usage: npm run tracker -- scan | seen | fixed | made | rejected | open | release | post | list');
  process.exit(command ? 1 : 0);
}

try {
  await main();
} catch (err) {
  fail(`tracker: ${err.message}`);
}
