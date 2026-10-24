/** The decisions behind `npm run tracker`, kept pure (no network, no disk)
 *  so tests/ember-tools.test.mjs can check every one of them. */

import { createHash } from 'node:crypto';

export const DISCORD_LIMIT = 2000;
export const STATUSES = ['fixed', 'made', 'rejected', 'open'];
export const BUG_CHANNEL = 'bug-reports';
export const AUTHOR_CAP = 5;
export const BUG_LINES_CAP = 15;
const HOUR = 36e5;

export const emptyState = () => ({ channelId: null, messageIds: [], seen: {}, items: [], lastId: {}, postedHash: null, lastSync: null });

/** A saved state with every field present, whatever the file held. */
export function normalizeState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    channelId: s.channelId ?? null,
    messageIds: Array.isArray(s.messageIds) ? s.messageIds : [],
    seen: s.seen && typeof s.seen === 'object' ? s.seen : {},
    items: Array.isArray(s.items) ? s.items : [],
    lastId: s.lastId && typeof s.lastId === 'object' ? s.lastId : {},
    postedHash: s.postedHash ?? null,
    lastSync: s.lastSync ?? null,
  };
}

/** A Discord message link or a bare message id -> { id, guild?, channelId? }, or null. */
export function parseTarget(arg) {
  const text = String(arg ?? '').trim().replace(/^<|>$/g, '');
  const link = /^https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/.exec(text);
  if (link) return { guild: link[1], channelId: link[2], id: link[3] };
  if (/^\d{15,25}$/.test(text)) return { id: text };
  return null;
}

export const messageLink = (guild, channelId, id) => `https://discord.com/channels/${guild}/${channelId}/${id}`;

/** All the readable text of a message: content, or embed title and
 *  description when the content is empty (webhook bug reports). */
export function messageText(m) {
  const content = (m.content ?? '').trim();
  const embed = (m.embeds ?? []).map((e) => `${e.title ?? ''} ${e.description ?? ''}`.trim()).filter(Boolean).join(' ');
  return (content || embed).replace(/\s+/g, ' ').trim();
}

const NOISE = /^[\s*_#>`~-]*(daily\s+(error\s+)?digest|weekly\s+digest|digest\b|release\s+notes|changelog|what'?s\s+new|(ember\s+)?v?\d+\.\d+\.\d+\s+(is\s+)?(released|out|live)|released\s+v?\d)/i;

/** Digests and release-notes posts by a bot are not requests. Webhook bug
 *  reports are bot-authored too and stay. */
/** Messages by people shorter than this are chat. */
export const CHAT_MIN = 60;

export function isNoise(m) {
  // A short message by a person is chat, not a report or request.
  if (!m.author?.bot && !m.webhook_id) return (m.content ?? '').trim().length < CHAT_MIN;
  const first = [m.content ?? '', m.embeds?.[0]?.title ?? ''].map((t) => t.trim()).filter(Boolean);
  return first.some((t) => NOISE.test(t));
}

/** Messages worth showing in a scan: not tracked, not seen, not noise. */
export function newMessages(messages, state) {
  const tracked = new Set(state.items.map((i) => i.id));
  return messages.filter((m) => !tracked.has(m.id) && !state.seen[m.id] && !isNoise(m));
}

/** Add or update an item (by message id). Returns a new state. */
export function upsertItem(state, item) {
  const old = state.items.find((i) => i.id === item.id);
  const merged = { ...(old ?? {}), ...item };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  if (old && item.reason === undefined && item.status !== 'rejected') delete merged.reason;
  const seen = { ...state.seen };
  delete seen[item.id];
  return {
    ...state,
    seen,
    items: old ? state.items.map((i) => (i.id === item.id ? merged : i)) : [...state.items, merged],
  };
}

/** Mark messages as not worth tracking. */
export function markSeen(state, ids) {
  const seen = { ...state.seen };
  for (const id of ids) seen[id] = true;
  // Something put on the list by sync and then marked not worth tracking leaves it.
  return { ...state, seen, items: state.items.filter((i) => !seen[i.id]) };
}

/** Stamp `version` on every fixed/made item that has none. */
export function stampRelease(state, version) {
  let count = 0;
  const items = state.items.map((i) => {
    if ((i.status === 'fixed' || i.status === 'made') && !i.version) {
      count++;
      return { ...i, version };
    }
    return i;
  });
  return { state: { ...state, items }, count };
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function itemLine(i) {
  const link = `[open](<${i.link}>)`;
  if (i.status === 'rejected') return `- ${oneLine(i.summary)}${i.reason ? `: ${oneLine(i.reason)}` : ''} ${link}`;
  if (i.status === 'open') return `- ${oneLine(i.summary)} ${link}`;
  return `- ${oneLine(i.summary)} (${i.version || 'not released yet'}) ${link}`;
}

const SECTIONS = [
  ['fixed', '**✅ Fixed**'],
  ['made', '**✅ Made**'],
  ['open', '**🔨 Accepted, not done yet**'],
  ['rejected', '**❌ Rejected**'],
];

const byNewest = (a, b) => String(b.lastAt ?? b.at).localeCompare(String(a.lastAt ?? a.at));
const isBug = (i) => i.channel === BUG_CHANNEL;

function bugLine(i) {
  if (i.held) return `- ${i.count} more reports from ${i.author} (held)`;
  const times = i.count > 1 ? ` x${i.count}` : '';
  const back = i.cameBack ? ` (came back after fix in ${i.cameBack})` : '';
  return `- ${oneLine(i.summary)}${times}${back} [open](<${i.link}>)`;
}

/** The summary as lines; empty sections are left out, newest first. The
 *  unsorted bugs are capped so a flood cannot fill the channel. */
export function renderTracker(state, now = new Date()) {
  const lines = [`**Ember tracker** (updated ${stamp(now)})`];
  const fresh = state.items.filter((i) => i.status === 'new');
  const bugs = fresh.filter(isBug).sort((a, b) => Number(!!a.held) - Number(!!b.held) || byNewest(a, b));
  if (bugs.length) {
    const shown = bugs.slice(0, BUG_LINES_CAP).map(bugLine);
    if (bugs.length > BUG_LINES_CAP) shown.push(`- and ${bugs.length - BUG_LINES_CAP} more`);
    lines.push('', '**🐞 Bugs, not fixed yet**', ...shown);
  }
  const requests = fresh.filter((i) => !isBug(i)).sort(byNewest);
  if (requests.length) lines.push('', '**🆕 New requests, not sorted**', ...requests.map((i) => `- ${oneLine(i.summary)} [open](<${i.link}>)`));
  for (const [status, title] of SECTIONS) {
    const items = state.items.filter((i) => i.status === status).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (!items.length) continue;
    lines.push('', title, ...items.map(itemLine));
  }
  return lines.join('\n');
}

/** Cut `text` into messages of at most `limit` characters, only between
 *  lines. A single line over the limit is shortened with "...". */
export function splitMessages(text, limit = DISCORD_LIMIT) {
  const chunks = [];
  let cur = '';
  for (let line of text.split('\n')) {
    if (line.length > limit) line = `${line.slice(0, limit - 3)}...`;
    const next = cur === '' ? line : `${cur}\n${line}`;
    if (next.length > limit) {
      chunks.push(cur);
      cur = line;
    } else cur = next;
  }
  chunks.push(cur);
  // A chunk that is only blank lines would be refused by Discord.
  return chunks.map((c) => c.replace(/^\n+|\n+$/g, '')).filter((c) => c.trim());
}

/** Hash of the rendered list without its changing "updated" line, so an
 *  unchanged list is never posted again. */
export function bodyHash(text) {
  return createHash('sha256').update(text.split('\n').slice(1).join('\n')).digest('hex');
}
export const needsPost = (state, text) => state.postedHash !== bodyHash(text);

/** A Discord snowflake for a moment in time. */
export const snowflake = (ms) => String((BigInt(ms) - 1420070400000n) << 22n);

/** What makes two bug reports "the same": lowercase, without links, ids,
 *  numbers, quotes and extra spaces. */
export function fingerprint(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, ' ')
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{6,}\b/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/["'`\u201c\u201d\u2018\u2019]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First line of a message: its text, else the embed description (webhook
 *  bug reports have a generic title), else the embed title. */
export function firstLine(m) {
  const e = m.embeds?.[0];
  const raw = (m.content ?? '').trim() || (e?.description ?? '').trim() || (e?.title ?? '').trim();
  return raw.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
}
export function autoSummary(m) {
  // Request forms post an embed titled "New feature: <title>" or "Fix: <title>";
  // the title is the summary, the description only the detail.
  const title = (m.embeds?.[0]?.title ?? '').trim();
  const form = title.match(/^(?:new feature|fix):\s*(.+)$/i);
  const detail = (m.embeds?.[0]?.description ?? '').trim().split('\n')[0].trim();
  const line = (form ? (detail.length > 1 ? `${form[1]}: ${detail}` : form[1]) : firstLine(m)).replace(/\s+/g, ' ');
  return (line.length > 100 ? `${line.slice(0, 97)}...` : line) || '(attachment only)';
}
export const authorKey = (m) => m.author?.username ?? m.author?.id ?? 'unknown';

/** One new bug report: bumps a matching open group, reopens after a fix,
 *  folds a flood from one author into a single held line, or starts a group. */
export function addBugReport(state, m, guild) {
  const fp = fingerprint(firstLine(m));
  const author = authorKey(m);
  const time = Date.parse(m.timestamp);
  const iso = m.timestamp;
  const bugs = state.items.filter(isBug);
  const live = bugs.find((i) => i.fp === fp && !i.held && (i.status === 'new' || i.status === 'open' || i.status === 'rejected'));
  if (live && fp) {
    return { ...state, items: state.items.map((i) => (i === live ? { ...i, count: (i.count ?? 1) + 1, lastAt: iso } : i)) };
  }
  const fixed = fp ? bugs.filter((i) => i.fp === fp && i.status === 'fixed').sort(byNewest)[0] : null;
  const recent = bugs.filter((i) => i.status === 'new' && !i.held && i.author === author && time - Date.parse(i.at) < HOUR);
  if (recent.length >= AUTHOR_CAP) {
    const id = `held:${author}`;
    const held = state.items.find((i) => i.id === id);
    if (held) return { ...state, items: state.items.map((i) => (i === held ? { ...i, count: i.count + 1, lastAt: iso } : i)) };
    const item = { id, channel: BUG_CHANNEL, status: 'new', held: true, author, count: 1, summary: '', at: iso, lastAt: iso };
    return { ...state, items: [...state.items, item] };
  }
  const item = {
    id: m.id,
    channel: BUG_CHANNEL,
    link: messageLink(guild.id, guild.channels[BUG_CHANNEL], m.id),
    status: 'new',
    summary: autoSummary(m),
    fp,
    author,
    count: 1,
    at: iso,
    lastAt: iso,
    ...(fixed ? { cameBack: fixed.version || 'an unreleased build' } : {}),
  };
  return { ...state, items: [...state.items, item] };
}

/** Pull messages newer than each channel's lastId (first run: from now on)
 *  and add them. `fetchPage(channelId, afterId)` returns up to 100 messages.
 *  `channels` is { name: id }. Returns the new state and how many were seen. */
export async function syncMessages(state, { channels, fetchPage, guildId, now = Date.now() }) {
  let cur = { ...state, lastId: { ...state.lastId } };
  let seenCount = 0;
  const guild = { id: guildId, channels };
  for (const [name, id] of Object.entries(channels)) {
    if (!cur.lastId[id]) {
      cur.lastId[id] = snowflake(now);
      continue;
    }
    for (;;) {
      const page = [...(await fetchPage(id, cur.lastId[id]))].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      for (const m of page) {
        cur.lastId[id] = m.id;
        const known = cur.items.some((i) => i.id === m.id) || cur.seen[m.id];
        if (known || isNoise(m)) continue;
        seenCount++;
        if (name === BUG_CHANNEL) cur = addBugReport(cur, m, guild);
        else {
          cur = upsertItem(cur, {
            id: m.id,
            channel: name,
            link: messageLink(guildId, id, m.id),
            status: 'new',
            summary: autoSummary(m),
            at: m.timestamp,
          });
        }
      }
      if (page.length < 100) break;
    }
  }
  return { state: cur, seenCount };
}

/** The launchd agent that runs `tracker sync` on a timer. */
export function plistText({ label, node, script, log, interval }) {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${esc(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(node)}</string>
    <string>${esc(script)}</string>
    <string>sync</string>
  </array>
  <key>StartInterval</key><integer>${interval}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${esc(log)}</string>
  <key>StandardErrorPath</key><string>${esc(log)}</string>
</dict>
</plist>
`;
}
