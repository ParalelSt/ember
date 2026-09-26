/** A small in-memory PocketBase for the collaborative playlist route tests.
 *
 *  Two kinds of client share one set of rows:
 *
 *    member(uid)  a signed-in person's own session. It follows the real
 *                 rules: playlists and playlist_tracks only for the owner
 *                 (pb_hooks/ensure_owner_rules), playlist_members not at all
 *                 (ensure_collab_playlists), users only themselves, and
 *                 collaborative / invite_code / added_by refused like the
 *                 hooks refuse them.
 *    server()     the app's admin client: everything.
 *
 *  Filters understood: `a = "x"`, `a != "x"`, `a = true`, joined by all
 *  `&&` or all `||`, with `{:name}` params. Enough for the routes, not a
 *  PocketBase. */

type Row = Record<string, unknown> & { id: string; created: string };
type Store = Record<string, Row[]>;

const err = (status: number, message = 'refused') => Object.assign(new Error(message), { status });

let seq = 0;
const nextId = (prefix: string) => `${prefix}${String(++seq).padStart(15 - prefix.length, '0')}`;
const stamp = () => `2026-09-26 10:00:${String(seq % 60).padStart(2, '0')}.${String(seq).padStart(3, '0')}Z`;

export function createWorld() {
  const db: Store = { users: [], playlists: [], playlist_tracks: [], playlist_members: [], tracks: [] };
  /** Every write, as "<client>:<op>:<collection>". */
  const writes: string[] = [];

  function insert(collection: string, data: Record<string, unknown>): Row {
    const row = { id: nextId(collection.slice(0, 2)), created: stamp(), ...data } as Row;
    db[collection].push(row);
    return row;
  }

  function matches(row: Row, raw: string): boolean {
    const any = raw.includes(' || ');
    const clauses = raw.split(any ? ' || ' : ' && ');
    const test = (clause: string) => {
      const m = /^\s*(\w+)\s*(!?=)\s*(?:"([^"]*)"|(true|false))\s*$/.exec(clause);
      if (!m) throw new Error(`fake PocketBase cannot read filter: ${clause}`);
      const [, field, op, str, bool] = m;
      const want: unknown = bool !== undefined ? bool === 'true' : str;
      let have = row[field];
      if (have === undefined) have = bool !== undefined ? false : '';
      return op === '=' ? have === want : have !== want;
    };
    return any ? clauses.some(test) : clauses.every(test);
  }

  function sorted(rows: Row[], sort?: string): Row[] {
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

  const RELATIONS: Record<string, Record<string, string>> = {
    playlists: { user: 'users' },
    playlist_tracks: { playlist: 'playlists', track: 'tracks', added_by: 'users' },
    playlist_members: { playlist: 'playlists', user: 'users' },
  };

  function expand(collection: string, row: Row, spec?: string): Row {
    if (!spec) return row;
    const out: Row = { ...row, expand: {} };
    for (const path of spec.split(',')) {
      const [first, ...rest] = path.split('.');
      const target = RELATIONS[collection]?.[first];
      const related = target ? db[target].find((r) => r.id === row[first]) : undefined;
      if (!related) continue;
      const already = (out.expand as Record<string, Row>)[first] ?? { ...related };
      (out.expand as Record<string, Row>)[first] = rest.length ? expand(target, already, rest.join('.')) : already;
    }
    return out;
  }

  function client(who: { kind: 'member'; uid: string } | { kind: 'server' }) {
    const label = who.kind === 'server' ? 'server' : who.uid;
    const visible = (collection: string, row: Row): boolean => {
      if (who.kind === 'server') return true;
      const me = who.uid;
      switch (collection) {
        case 'playlists':
          return row.user === me;
        case 'playlist_tracks':
          return db.playlists.find((p) => p.id === row.playlist)?.user === me;
        case 'playlist_members':
          return false;
        case 'users':
          return row.id === me;
        default:
          return true;
      }
    };
    const guardWrite = (collection: string, data: Record<string, unknown>, before?: Row) => {
      if (who.kind === 'server') return;
      if (collection === 'playlist_members' || collection === 'tracks' || collection === 'users') throw err(403);
      if (collection === 'playlists') {
        if (!before && data.user !== who.uid) throw err(400);
        if ('collaborative' in data && data.collaborative !== (before?.collaborative ?? false)) throw err(403);
        if ('invite_code' in data && data.invite_code !== (before?.invite_code ?? '')) throw err(403);
      }
      if (collection === 'playlist_tracks') {
        const pid = (data.playlist ?? before?.playlist) as string;
        if (db.playlists.find((p) => p.id === pid)?.user !== who.uid) throw err(400);
        if (!before && data.added_by && data.added_by !== who.uid) throw err(403);
        if (before && 'added_by' in data && data.added_by !== before.added_by) throw err(403);
      }
    };

    return {
      label,
      autoCancellation: () => undefined,
      filter: (raw: string, params: Record<string, unknown> = {}) =>
        raw.replace(/\{:(\w+)\}/g, (_m, k: string) => (typeof params[k] === 'string' ? `"${params[k]}"` : String(params[k]))),
      collection: (collection: string) => {
        const list = (filter?: string, sort?: string, exp?: string) =>
          sorted(db[collection].filter((r) => visible(collection, r) && (!filter || matches(r, filter))), sort).map((r) =>
            expand(collection, r, exp),
          );
        return {
          getOne: async (id: string, opts: { expand?: string } = {}) => {
            const row = db[collection].find((r) => r.id === id);
            if (!row || !visible(collection, row)) throw err(404);
            return expand(collection, row, opts.expand);
          },
          getFullList: async (opts: { filter?: string; sort?: string; expand?: string } = {}) =>
            list(opts.filter, opts.sort, opts.expand),
          getList: async (_page: number, perPage: number, opts: { filter?: string; sort?: string } = {}) => {
            const all = list(opts.filter, opts.sort);
            return { items: all.slice(0, perPage), totalItems: all.length };
          },
          getFirstListItem: async (filter: string, opts: { sort?: string; expand?: string } = {}) => {
            const first = list(filter, opts.sort, opts.expand)[0];
            if (!first) throw err(404);
            return first;
          },
          create: async (data: Record<string, unknown>) => {
            guardWrite(collection, data);
            if (collection === 'playlist_tracks' && db.playlist_tracks.some((r) => r.playlist === data.playlist && r.track === data.track)) {
              throw err(400, 'Failed to create record.');
            }
            if (collection === 'playlist_members' && db.playlist_members.some((r) => r.playlist === data.playlist && r.user === data.user)) {
              throw err(400, 'Failed to create record.');
            }
            writes.push(`${label}:create:${collection}`);
            return insert(collection, data);
          },
          update: async (id: string, data: Record<string, unknown>) => {
            const row = db[collection].find((r) => r.id === id);
            if (!row || !visible(collection, row)) throw err(404);
            guardWrite(collection, data, row);
            writes.push(`${label}:update:${collection}`);
            Object.assign(row, data);
            return { ...row };
          },
          delete: async (id: string) => {
            const row = db[collection].find((r) => r.id === id);
            if (!row || !visible(collection, row)) throw err(404);
            if (who.kind === 'member' && collection === 'playlist_members') throw err(403);
            writes.push(`${label}:delete:${collection}`);
            db[collection] = db[collection].filter((r) => r.id !== id);
            if (collection === 'playlists') {
              db.playlist_tracks = db.playlist_tracks.filter((r) => r.playlist !== id);
              db.playlist_members = db.playlist_members.filter((r) => r.playlist !== id);
            }
            return true;
          },
        };
      },
    };
  }

  return {
    db,
    writes,
    member: (uid: string) => client({ kind: 'member', uid }),
    server: () => client({ kind: 'server' }),
    addUser: (name: string, extra: Record<string, unknown> = {}) =>
      insert('users', { name, email: `${name.toLowerCase() || 'x'}@ember.test`, collectionId: '_pb_users_auth_', avatar: '', ...extra }),
    addTrack: (externalId: string, title = externalId) =>
      insert('tracks', { external_id: externalId, source: 'youtube', source_id: externalId.split(':')[1], title, artist: 'Band' }),
    addPlaylist: (user: string, name: string, extra: Record<string, unknown> = {}) =>
      insert('playlists', { user, name, collaborative: false, invite_code: '', artwork: '', ...extra }),
    addRow: (playlist: string, track: string, position: number, addedBy = '') =>
      insert('playlist_tracks', { playlist, track, position, added_by: addedBy }),
    addMember: (playlist: string, user: string) => insert('playlist_members', { playlist, user }),
  };
}

export type World = ReturnType<typeof createWorld>;
