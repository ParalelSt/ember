/** A tiny PocketBase at the HTTP level, for tests that measure how many
 *  requests a route really sends. Stub `fetch` with `world.fetch` and use
 *  the real PocketBase SDK against BASE: its paging (getFullList asks page
 *  after page until one comes back short), its auto-cancellation and its
 *  query encoding all run for real.
 *
 *  Like PocketBase 0.22 it caps perPage at 500. Filters understood:
 *  `field = 'x'` clauses joined by all `||` or all `&&`. Sort on plain
 *  fields, one level of expand (`track`, `playlist`) plus `playlist.user`.
 *  Access rules are not modelled: every token sees every row. */

export const BASE = 'http://pb.test';

type Row = Record<string, unknown> & { id: string; created: string };

const RELATIONS: Record<string, Record<string, string>> = {
  playlists: { user: 'users' },
  playlist_tracks: { playlist: 'playlists', track: 'tracks' },
  playlist_members: { playlist: 'playlists', user: 'users' },
};

export function createHttpWorld() {
  const db: Record<string, Row[]> = { users: [], playlists: [], playlist_tracks: [], playlist_members: [], tracks: [] };
  /** Every request, as "METHOD /path". */
  const requests: string[] = [];
  const byId = new Map<string, Row>();
  let seq = 0;

  function insert(collection: string, data: Record<string, unknown>): Row {
    seq += 1;
    const row = { id: `${collection.slice(0, 2)}${String(seq).padStart(13, '0')}`, created: `2026-11-25 10:00:00.${String(seq).padStart(6, '0')}Z`, ...data } as Row;
    db[collection].push(row);
    byId.set(row.id, row);
    return row;
  }

  function matches(row: Row, raw: string): boolean {
    if (!raw) return true;
    const any = raw.includes(' || ');
    const clauses = raw.split(any ? ' || ' : ' && ');
    const test = (clause: string) => {
      const m = /^\s*\(?\s*([\w.]+)\s*=\s*(?:'([^']*)'|"([^"]*)")\s*\)?\s*$/.exec(clause);
      if (!m) throw new Error(`fake PocketBase cannot read filter: ${clause}`);
      return String(row[m[1]] ?? '') === (m[2] ?? m[3]);
    };
    return any ? clauses.some(test) : clauses.every(test);
  }

  function sorted(rows: Row[], sort: string | null): Row[] {
    if (!sort) return rows;
    const keys = sort.split(',').map((k) => (k.startsWith('-') ? { f: k.slice(1), d: -1 } : { f: k, d: 1 }));
    return [...rows].sort((a, b) => {
      for (const { f, d } of keys) {
        const x = a[f] as string | number;
        const y = b[f] as string | number;
        if (x < y) return -d;
        if (x > y) return d;
      }
      return 0;
    });
  }

  function expand(collection: string, row: Row, spec: string | null): Row {
    if (!spec) return row;
    const out: Row = { ...row, expand: {} };
    for (const path of spec.split(',')) {
      const [first, ...rest] = path.split('.');
      const target = RELATIONS[collection]?.[first];
      const related = target ? byId.get(String(row[first])) : undefined;
      if (!related) continue;
      const already = (out.expand as Record<string, Row>)[first] ?? { ...related };
      (out.expand as Record<string, Row>)[first] = rest.length ? expand(target, already, rest.join('.')) : already;
    }
    return out;
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    requests.push(`${method} ${url.pathname}`);
    const list = /^\/api\/collections\/([\w]+)\/records$/.exec(url.pathname);
    if (list && method === 'GET') {
      const collection = list[1];
      const q = url.searchParams;
      const page = Math.max(1, Number(q.get('page') ?? 1));
      const perPage = Math.min(500, Math.max(1, Number(q.get('perPage') ?? 30)));
      const all = sorted((db[collection] ?? []).filter((r) => matches(r, q.get('filter') ?? '')), q.get('sort'));
      const items = all.slice((page - 1) * perPage, page * perPage).map((r) => expand(collection, r, q.get('expand')));
      const skipTotal = q.get('skipTotal') === '1' || q.get('skipTotal') === 'true';
      return json({
        page,
        perPage,
        totalItems: skipTotal ? -1 : all.length,
        totalPages: skipTotal ? -1 : Math.ceil(all.length / perPage),
        items,
      });
    }
    return json({ code: 404, message: 'not found', data: {} }, 404);
  }

  return {
    db,
    requests,
    fetch: handle,
    /** Requests whose path contains `part`. */
    count: (part: string) => requests.filter((r) => r.includes(part)).length,
    addUser: (id: string, name = id) => {
      const row = { id, created: '2026-01-01 00:00:00.000Z', name } as Row;
      db.users.push(row);
      byId.set(id, row);
      return row;
    },
    addPlaylist: (user: string, name: string, extra: Record<string, unknown> = {}) => insert('playlists', { user, name, ...extra }),
    addTrack: (artwork: string) => insert('tracks', { artwork_url: artwork }),
    addRow: (playlist: string, track: string, position: number) => insert('playlist_tracks', { playlist, track, position }),
    addMember: (playlist: string, user: string) => insert('playlist_members', { playlist, user }),
  };
}
