/** The pure half of `npm run perf` (scripts/ember/perf.mjs): the query it
 *  asks GET /api/admin/perf, the admin's session cookie, and the text it
 *  prints. Tested in tests/ember-tools.test.mjs. */

/** The pb_auth cookie the web app reads, from a PocketBase sign-in answer. */
export function adminCookie(token, record) {
  return `pb_auth=${encodeURIComponent(JSON.stringify({ token, model: record }))}`;
}

/** The API's query string. An email in `user` is matched by the script
 *  itself (the API takes ids only). */
export function perfQuery({ session, user, days } = {}) {
  const q = new URLSearchParams();
  if (session) q.set('session', session);
  if (user && !user.includes('@')) q.set('user', user);
  if (days) q.set('days', String(days));
  const s = q.toString();
  return s ? `?${s}` : '';
}

const sec = (ms) => (typeof ms === 'number' && ms > 0 ? `${(ms / 1000).toFixed(1)}s` : '-');
const when = (ts) => new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
const pad = (s, n) => String(s).slice(0, n).padEnd(n);

export function whoOf(s) {
  return s.name ? `${s.name} <${s.email ?? s.userId}>` : (s.email ?? s.userId);
}

export function deviceOf(s) {
  const d = s.device ?? {};
  const parts = [d.model ?? s.shell];
  if (d.mem) parts.push(`${d.mem}GB`);
  return parts.join(' ');
}

/** One line per session, newest first. */
export function formatSessions(sessions) {
  if (!sessions.length) return ['No perf sessions in this window.'];
  const head = `${pad('last seen (UTC)', 17)} ${pad('who', 28)} ${pad('device', 22)} ${pad('app', 8)} ${pad('ready', 7)} ${pad('nav p50/p95/max', 20)} ${pad('freeze', 7)} ${pad('heap MB', 12)} session`;
  const rows = sessions.map((s) => {
    const nav = s.nav?.n ? `${sec(s.nav.p50)}/${sec(s.nav.p95)}/${sec(s.nav.max)}` : '-';
    const heap = s.heap ? `${s.heap.first}->${s.heap.last}` : '-';
    const freeze = s.freezes?.n ? `${s.freezes.n}x${sec(s.freezes.max)}` : '-';
    return `${pad(when(s.last), 17)} ${pad(whoOf(s), 28)} ${pad(deviceOf(s), 22)} ${pad(s.app, 8)} ${pad(sec(s.launch?.hydrated), 7)} ${pad(nav, 20)} ${pad(freeze, 7)} ${pad(heap, 12)} ${s.session}`;
  });
  return [head, ...rows];
}

/** One event as a line. */
export function eventLine(e) {
  switch (e.k) {
    case 'nav':
      return `nav ${e.via} to ${e.to}${e.ms !== undefined ? ` ${sec(e.ms)}` : ''}${e.server !== undefined ? ` (server ${sec(e.server)}` + `${e.commit !== undefined ? `, after answer ${sec(e.commit)}` : ''})` : ''}${e.lt ? ` long tasks ${e.lt}ms` : ''}${e.playing ? ' while playing' : ''}${e.abandoned ? ' ABANDONED' : ''}`;
    case 'freeze':
      return `FREEZE ${sec(e.ms)}`;
    case 'rage':
      return `RAGE ${e.taps} taps on ${e.target}${e.pending !== undefined ? `, navigation pending ${sec(e.pending)}` : ''}${e.overlay ? ', overlay up' : ''}${e.inert ? ', inert page' : ''}`;
    case 'slow':
      return `slow ${e.type} ${e.ms}ms${e.target ? ` on ${e.target}` : ''}`;
    default:
      return JSON.stringify(e);
  }
}

/** One batch as a line. */
function batchLine(r) {
  const parts = [`batch ${r.seq}: fg ${Math.round(r.fgMs / 1000)}s`];
  if (r.nav?.n) parts.push(`nav ${r.nav.n}`);
  if (r.lt?.n) parts.push(`long tasks ${r.lt.n} ${sec(r.lt.ms)} max ${r.lt.max}ms${r.lt.top?.length ? ` [${r.lt.top.map(([s, ms]) => `${s} ${ms}ms`).join(', ')}]` : ''}`);
  if (r.slow?.n) parts.push(`slow taps ${r.slow.n} max ${r.slow.max}ms`);
  if (r.freeze?.n) parts.push(`freezes ${r.freeze.n} max ${sec(r.freeze.max)}`);
  if (r.heap) parts.push(`heap ${r.heap.used}MB`);
  if (r.dom !== undefined) parts.push(`dom ${r.dom}`);
  if (r.api?.length) parts.push(`api ${r.api.map(([route, n, p50, max]) => `${route} ${n}x p50 ${p50}ms max ${max}ms`).join('; ')}`);
  if (r.evDropped) parts.push(`${r.evDropped} events not kept`);
  return parts.join(' | ');
}

const whenSec = (ts) => new Date(ts).toISOString().slice(0, 19).replace('T', ' ');

/** One session's full timeline: a header, then its events and batches
 *  merged in the order they happened. */
export function formatTimeline(session, timeline, events = []) {
  const lines = [
    `${whoOf(session)}, ${deviceOf(session)}, app ${session.app} (${session.shell})`,
    `session ${session.session}: ${session.digests} batches, ${Math.round(session.fgMs / 60000)} min in the foreground` +
      (session.missing?.length ? `, batches never arrived: ${session.missing.join(', ')}` : ''),
  ];
  if (session.launch) {
    const l = session.launch;
    lines.push(`launch: first byte ${sec(l.ttfb)}, first paint ${sec(l.fcp)}, ready ${sec(l.hydrated)}, scripts ${l.scripts ?? '-'} (${l.scriptKb ?? '-'} KB, ${l.cached ?? '-'} cached), ${l.proto ?? ''}`.trim());
  }
  const rows = [
    ...events.map((e) => ({ ts: e.ts, order: 0, text: eventLine(e) })),
    ...timeline.map((r) => ({ ts: r.ts, order: 1, text: batchLine(r) })),
  ].sort((a, b) => a.ts - b.ts || a.order - b.order);
  for (const r of rows) lines.push(`${whenSec(r.ts)}  ${r.text}`);
  return lines;
}

/** The query for /api/admin/perf-rollup (`npm run perf -- --rollup`). */
export function rollupQuery({ hours } = {}) {
  return hours ? `?hours=${encodeURIComponent(String(hours))}` : '';
}

const PLATFORM = { android: 'Android', ios: 'iOS', windows: 'Windows', macos: 'macOS', linux: 'Linux', other: 'Other' };

/** The perf channel's rollup as text: what happened to it (posted, dry
 *  run, or why not), then one block per platform when the answer has the
 *  numbers (the dry run). */
export function formatRollup(body) {
  const t = body.totals ?? { sessions: 0, members: 0 };
  const outcome = body.dryRun ? 'dry run, nothing posted' : body.posted ? 'posted' : `not posted (${body.reason ?? 'unknown'})`;
  const lines = [
    `Perf rollup ${String(body.since).slice(0, 16)} to ${String(body.until).slice(0, 16)} UTC (${body.hours} h): ${t.sessions} sessions, ${t.members} members, webhook ${body.webhook}, ${outcome}.`,
  ];
  for (const p of body.rollup?.platforms ?? []) {
    const name = pad(PLATFORM[p.os] ?? p.os, 8);
    if (!p.sessions) {
      lines.push(`${name} no sessions`);
      continue;
    }
    const shells = Object.entries(p.shells ?? {}).map(([s, n]) => `${s} ${n}`).join(', ');
    lines.push(
      `${name} ${p.sessions} sessions, ${p.members} members, ${p.fgHours} h (${shells}); ready p50 ${sec(p.launch?.hydrated?.p50)}; ` +
        `nav ${p.nav.n} p50/p95/max ${sec(p.nav.p50)}/${sec(p.nav.p95)}/${sec(p.nav.max)}; freezes ${p.freezes.n}; heap p50 ${p.heap.p50} MB, growth p95 ${p.heap.growth.p95} MB`,
    );
    const side = p.sideNav ?? { taps: 0, abandoned: 0, routes: [] };
    lines.push(`         side nav: ${side.taps} taps loaded, ${side.abandoned} re-tapped before loading`);
    for (const r of side.routes) {
      const where = r.phased ? `, host ${sec(r.serverP50)} / page ${sec(r.commitP50)} (${r.phased})` : '';
      lines.push(`           ${pad(r.route, 24)} ${r.n}x p50 ${sec(r.p50)} p95 ${sec(r.p95)}${where}${r.abandoned ? `, ${r.abandoned} re-tapped` : ''}`);
    }
  }
  return lines;
}
