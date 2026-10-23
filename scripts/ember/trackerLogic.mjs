/** The decisions behind `npm run tracker`, kept pure (no network, no disk)
 *  so tests/ember-tools.test.mjs can check every one of them. */

export const DISCORD_LIMIT = 2000;
export const STATUSES = ['fixed', 'made', 'rejected', 'open'];

export const emptyState = () => ({ channelId: null, messageIds: [], seen: {}, items: [] });

/** A saved state with every field present, whatever the file held. */
export function normalizeState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    channelId: s.channelId ?? null,
    messageIds: Array.isArray(s.messageIds) ? s.messageIds : [],
    seen: s.seen && typeof s.seen === 'object' ? s.seen : {},
    items: Array.isArray(s.items) ? s.items : [],
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
export function isNoise(m) {
  if (!m.author?.bot) return false;
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
  return { ...state, seen };
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
  const link = `<${i.link}>`;
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

/** The summary as lines; empty sections are left out, newest first. */
export function renderTracker(state, now = new Date()) {
  const lines = [`**Ember tracker** (updated ${stamp(now)})`];
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
