/** The decisions the Ember tools make, kept pure (no git, no network, no
 *  disk) so tests/ember-tools.test.mjs can check every one of them. */

/** Ports a sandbox may use: never the owner's live app (3000) or live
 *  PocketBase (8090). */
export const LIVE_PORTS = [3000, 8090];
export const SANDBOX_PORTS = { first: 3050, last: 3099 };
export const SANDBOX_PB_PORT = 8088;

/** Why this port cannot host a sandbox, or null when it can. */
export function sandboxPortProblem(port) {
  if (!Number.isInteger(port)) return 'the port must be a number';
  if (LIVE_PORTS.includes(port)) return `${port} is your live Ember, sandboxes never touch it`;
  if (port < 3001 || port > 3999) return 'pick a port between 3001 and 3999';
  return null;
}

/** First port in the sandbox range nobody listens on. */
export function pickFreePort(busy) {
  for (let p = SANDBOX_PORTS.first; p <= SANDBOX_PORTS.last; p++) if (!busy.includes(p)) return p;
  return null;
}

/** True when `dir` is the live PocketBase data, which nothing may open. */
export function isLivePbData(dir, mainCheckout) {
  const norm = (s) => s.replace(/\/+$/, '');
  return norm(dir) === norm(`${mainCheckout}/pocketbase/pb_data`);
}

/** "fix/reported-1022" -> "reported-1022", the worktree folder name. */
export function worktreeFolder(branch) {
  const name = branch.split('/').pop().replace(/[^A-Za-z0-9._-]/g, '-');
  if (!name || name === '.' || name === '..') throw new Error(`Cannot make a folder name from "${branch}"`);
  return name;
}

/** A branch name git and the house style accept: lowercase words and
 *  dashes, one optional "kind/" in front. */
export function branchNameProblem(name) {
  if (!name) return 'give the branch a name, e.g. fix/search-crash';
  if (!/^([a-z]+\/)?[a-z0-9]+([.-][a-z0-9]+)*$/.test(name)) return 'use lowercase words joined by dashes, e.g. fix/search-crash';
  if (name === 'main') return 'main is never worked on directly';
  return null;
}

/** The release notes skeleton from the commits since main. */
export function draftNotes(branch, subjects) {
  const kept = subjects
    .filter((s) => !/^(Merge |chore|test|docs|ci|style|refactor|wip)\b/i.test(s))
    .map((s) => s.replace(/^\w+(\([^)]*\))?!?:\s*/, ''))
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`));
  const slug = worktreeFolder(branch || 'release').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'release';
  const title = slug.replace(/^(fix|feat|ui|chore)-/, '').replace(/-/g, ' ');
  return [
    '# Release notes. Edit the wording, then: npm run release',
    '# One line each for id, title and summary; one "- " line per bullet.',
    '# host: is optional, for anything the host must do besides ./update.sh.',
    `id: ${slug}`,
    `title: ${title.charAt(0).toUpperCase()}${title.slice(1)}`,
    `summary: ${kept[0] ?? 'Describe the release in one line.'}`,
    ...(kept.length ? kept : ['Describe what changed for people using Ember.']).map((s) => `- ${s}`),
    '',
  ].join('\n');
}

/** Things that must never leave the Mac, as [label, pattern]. */
export const SECRET_PATTERNS = [
  ['Discord webhook URL', /discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]{20,}/],
  ['Discord bot token', /\b[MN][\w-]{23,25}\.[\w-]{6}\.[\w-]{27,40}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  // A value read from somewhere else (env.X, process.env.X) or an obvious
  // stand-in (fake, example, placeholder) is not a password.
  ['password in a setting', /(PASSWORD|_SECRET|_TOKEN|KEYSTORE_PASS\w*)\s*[=:]\s*["']?(?!(?:process\.)?env\.|[\w-]*(?:fake|example|placeholder))[^\s"'$<>{}]{8,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['Anthropic or OpenAI key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/],
];

const EM_DASH = '\u2014';
const PRANK_FILES = /(^|\/)(UPDATE_NOTES\.md|apps\/web\/lib\/changelog\.ts)$/;

/** Problems in the lines a push adds, from `git diff -U0` output. */
export function scanAddedLines(diff) {
  const problems = [];
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.replace(/^\+\+\+ (b\/)?/, '');
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const text = line.slice(1);
    // Test files may spell out what they guard against.
    const isTest = /\.test\.|(^|\/)tests?\//.test(file);
    if (!isTest) {
      for (const [label, re] of SECRET_PATTERNS) {
        if (re.test(text) && !/process\.env|example|placeholder|\$\{|<[A-Z_]+>/i.test(text)) problems.push(`${file}: looks like a ${label}`);
      }
    }
    if (text.includes(EM_DASH)) problems.push(`${file}: em dash`);
    if (PRANK_FILES.test(file) && /\bpranks?\b/i.test(text)) problems.push(`${file}: mentions pranks in What's new`);
  }
  return [...new Set(problems)];
}

/** Of `branches` (name -> {merged, worktree, dirty}), the ones safe to
 *  delete: merged into main, never main itself, and with no uncommitted
 *  work in their worktree. */
export function tidyPlan(branches, current) {
  const remove = [];
  const keep = [];
  for (const [name, b] of Object.entries(branches)) {
    if (name === 'main' || name === current) continue;
    if (!b.merged) continue;
    if (b.dirty) keep.push({ name, why: 'has uncommitted changes' });
    else remove.push({ name, worktree: b.worktree ?? null });
  }
  return { remove, keep };
}

/** "0.7.30 (9081feae 2026-10-15)" -> "0.7.30". */
export function plainVersion(v) {
  return /\d+\.\d+\.\d+/.exec(v ?? '')?.[0] ?? null;
}

/** The host compared with what main has. */
export function hostVerdict(hostVersion, mainVersion) {
  const host = plainVersion(hostVersion);
  if (!host) return { due: true, line: 'The host runs an older Ember, from before host-check existed: run ./update.sh on the host.' };
  const parts = (v) => v.split('.').map(Number);
  const [a, b] = [parts(host), parts(mainVersion)];
  const behind = a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
  return behind
    ? { due: true, line: `The host runs ${host}, main is ${mainVersion}: run ./update.sh on the host.` }
    : { due: false, line: `The host is up to date (${host}).` };
}

/** One Discord message as a report line. Webhook posts keep their text in
 *  embeds, so those are read too. */
export function messageLine(m) {
  let text = m.content ?? '';
  for (const e of m.embeds ?? []) {
    text += ` ${e.title ?? ''} :: ${(e.description ?? '').slice(0, 1500)}`;
    for (const f of e.fields ?? []) text += ` | ${f.name}: ${String(f.value).slice(0, 300)}`;
  }
  const files = (m.attachments ?? []).map((a) => a.filename);
  return `- ${m.timestamp.slice(0, 16)} ${m.author?.username ?? '?'}: ${text.replace(/\s*\n\s*/g, ' / ').trim().slice(0, 2500)}${
    files.length ? ` [files: ${files.join(', ')}]` : ''
  }`;
}

/** A short headline for one message, for the summary on screen. */
export function messageHeadline(m) {
  const e = m.embeds?.[0];
  const raw = e ? `${e.title ?? ''} ${e.description ?? ''}` : m.content ?? '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 110) || '(attachment only)';
}

/** Daily digests are noise in a list of things to do. */
export function isDigest(m) {
  return /Daily error digest/i.test(m.embeds?.[0]?.title ?? '');
}
