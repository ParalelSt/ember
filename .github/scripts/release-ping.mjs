// Once-an-evening "new version" Discord ping. Node 20 built-ins only.
// See .github/workflows/release-ping.yml for the config and the state model.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TAG = 'notified/main';
export const TZ = 'Europe/Zagreb';
export const FROM_HOUR = 19;

/** Local date (YYYY-MM-DD) and hour in Europe/Zagreb for an instant. */
export function localParts(now, timeZone = TZ) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/** Decide whether to ping. tag = { commit, date } or null. */
export function decide({ now, head, tag }) {
  const { date, hour } = localParts(now);
  if (hour < FROM_HOUR) return { ping: false, reason: 'before 19:00 local', date };
  if (tag && tag.commit === head) return { ping: false, reason: 'nothing new', date };
  if (tag && tag.date === date) return { ping: false, reason: 'already pinged this evening', date };
  return { ping: true, reason: 'new version', date };
}

const cmp = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
export const isNewer = (a, b) => cmp(a, b) > 0;

/** New UPDATE_NOTES sections (newer than sinceVersion) with their first bold text. */
export function extraNotes(src, sinceVersion) {
  const out = [];
  for (const sec of src.split(/^(?=# \d)/m)) {
    const h = /^# (\d+\.\d+\.\d+)/.exec(sec);
    if (!h || (sinceVersion && !isNewer(h[1], sinceVersion))) continue;
    const b = /\*\*([\s\S]*?)\*\*/.exec(sec);
    if (!b) continue;
    const text = b[1].replace(/\s+/g, ' ').trim();
    if (/prank/i.test(text)) continue;
    const rest = text
      .replace(/host:/i, '')
      .replace(/run\s+`?\.\/update\.sh`?(\s+as usual)?/i, '')
      .replace(/\(no new packages\)/i, '')
      .replace(/[\s.,;:]+/g, ' ')
      .trim();
    if (rest) out.push(text);
  }
  return out;
}

const NEEDS_UPDATE = /^(apps\/web\/|pocketbase\/|player\.py$|scripts\/)/;

/** Build the Discord message text. */
export function buildMessage({
  userId, webVersion, appsVersion, changedPaths = [], notesExtra = [],
}) {
  const head = `<@${userId}> New version available: web ${webVersion}` + (appsVersion ? ` (apps ${appsVersion})` : '');
  const lines = [head];
  if (changedPaths.some((p) => NEEDS_UPDATE.test(p))) lines.push('- Pull and run ./update.sh');
  for (const n of notesExtra.slice(0, 2)) lines.push(`- ${n.length > 200 ? n.slice(0, 197) + '...' : n}`);
  return lines.filter((l) => !/prank/i.test(l)).slice(0, 6).join('\n');
}

function gitRunner(cwd) {
  return (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Orchestration. deps: { now, env, git, fetch, log } (all injectable). */
export async function run(deps) {
  const { now, env, git, log } = deps;
  const doFetch = deps.fetch;
  const hook = env.DISCORD_RELEASE_WEBHOOK;
  const userId = env.DISCORD_NOTIFY_USER_ID;
  const tryGit = (...a) => { try { return git(...a); } catch { return null; } };

  const head = git('rev-parse', 'HEAD');
  const tagCommit = tryGit('rev-parse', '--verify', '-q', `refs/tags/${TAG}^{commit}`);
  const tagDate = tagCommit ? tryGit('tag', '-l', '--format=%(contents)', TAG)?.trim() : null;
  const tag = tagCommit ? { commit: tagCommit, date: tagDate } : null;

  const d = decide({ now, head, tag });
  if (!d.ping) { log(`no ping: ${d.reason}`); return { pinged: false, reason: d.reason }; }
  if (!hook || !userId) {
    log('DISCORD_RELEASE_WEBHOOK or DISCORD_NOTIFY_USER_ID missing; not pinging, tag not moved');
    return { pinged: false, reason: 'not configured' };
  }

  const base = tagCommit || tryGit('rev-parse', 'HEAD~1') || head;
  const changed = (tryGit('diff', '--name-only', base, head) || '').split('\n').filter(Boolean);
  const pkgVersion = (rev) => {
    try { return JSON.parse(git('show', `${rev}:apps/web/package.json`)).version; } catch { return null; }
  };
  const webVersion = pkgVersion(head);
  const sinceVersion = pkgVersion(base);
  const show = (rev, p) => tryGit('show', `${rev}:${p}`) || '';

  const tagsAt = (rev) => (tryGit('tag', '--merged', rev, '--list', 'v0.4.*') || '').split('\n').filter(Boolean);
  const bare = (t) => t.replace(/^v/, '');
  const atHead = tagsAt(head).sort((a, b) => cmp(bare(a), bare(b)));
  const appsVersion = atHead.length ? bare(atHead[atHead.length - 1]) : null;

  // Nothing the host runs changed (CI, docs, tests): no ping, and no tag
  // move either, so these commits ride along with the next real change.
  if (!changed.some((p) => NEEDS_UPDATE.test(p))) {
    log('nothing for the host to update');
    return { pinged: false, reason: 'nothing for the host' };
  }

  const text = buildMessage({
    userId, webVersion, appsVersion, changedPaths: changed,
    notesExtra: extraNotes(show(head, 'UPDATE_NOTES.md'), sinceVersion),
  });

  const res = await doFetch(hook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: text, allowed_mentions: { users: [userId] } }),
  });
  if (!res.ok) {
    log(`Discord POST failed: ${res.status}`);
    const e = new Error(`Discord POST failed: ${res.status}`);
    e.exitCode = 1;
    throw e;
  }
  git('tag', '-f', '-a', TAG, '-m', d.date, head);
  if (!deps.noPush) git('push', '-f', 'origin', `refs/tags/${TAG}`);
  log('pinged and moved tag');
  return { pinged: true, text };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const now = process.env.RELEASE_PING_NOW ? new Date(process.env.RELEASE_PING_NOW) : new Date();
  run({ now, env: process.env, git: gitRunner(process.cwd()), fetch: globalThis.fetch, log: console.log })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
