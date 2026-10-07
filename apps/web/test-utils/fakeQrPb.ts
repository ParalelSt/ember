import PocketBase from 'pocketbase';

/** An in-memory stand-in for the server's admin PocketBase client, enough
 *  for the QR sign-in routes: the login_requests collection (with the unique
 *  code and token_hash indexes), the users the mint hook signs in, and the
 *  two hook routes behind pb.send. Filters are the SDK's own pb.filter()
 *  output, read back clause by clause (`a = 'x' && b >= '...'`). */

export type Row = Record<string, unknown> & { id: string; created: string; updated: string };

const pbNow = () => new Date().toISOString().replace('T', ' ');
let seq = 0;
const newId = () => `r${String(++seq).padStart(14, '0')}`.slice(0, 15);

function notFound(): Error {
  return Object.assign(new Error("The requested resource wasn't found."), { status: 404, response: { code: 404, message: 'not found', data: {} } });
}

function parseValue(raw: string): unknown {
  const t = raw.trim();
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/\\'/g, "'");
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  return Number(t);
}

function matcher(filter: string | undefined): (r: Row) => boolean {
  if (!filter) return () => true;
  const clauses = filter.split(' && ').map((c) => {
    const m = /^\s*(\w+)\s*(>=|<=|!=|=|>|<)\s*(.+?)\s*$/.exec(c);
    if (!m) throw new Error(`fakeQrPb cannot read filter clause: ${c}`);
    return { field: m[1], op: m[2], value: parseValue(m[3]) };
  });
  return (r) =>
    clauses.every(({ field, op, value }) => {
      const v = r[field] ?? '';
      switch (op) {
        case '=': return v === value;
        case '!=': return v !== value;
        case '>=': return String(v) >= String(value);
        case '<=': return String(v) <= String(value);
        case '>': return String(v) > String(value);
        default: return String(v) < String(value);
      }
    });
}

function sorter(sort: string | undefined): (a: Row, b: Row) => number {
  if (!sort) return () => 0;
  const desc = sort.startsWith('-');
  const field = sort.replace(/^[-+]/, '');
  return (a, b) => (String(a[field] ?? '') < String(b[field] ?? '') ? -1 : String(a[field] ?? '') > String(b[field] ?? '') ? 1 : 0) * (desc ? -1 : 1);
}

export interface FakeUser {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
}

export function createFakeQrPb() {
  const rows = new Map<string, Row>();
  const users = new Map<string, FakeUser>();
  const minted: string[] = [];
  const revoked: string[] = [];
  /** Throw from the next mint (a PocketBase outage). */
  let failNextMint: Error | null = null;
  /** Collide with the unique code index this many times on create. */
  let codeCollisions = 0;
  const sdk = new PocketBase('http://127.0.0.1:1');

  const collection = (name: string) => {
    if (name !== 'login_requests') throw new Error(`fakeQrPb has no collection ${name}`);
    return {
      async create(data: Record<string, unknown>) {
        const clash = [...rows.values()].find((r) => r.code === data.code || r.token_hash === data.token_hash);
        if (clash || codeCollisions > 0) {
          if (codeCollisions > 0) codeCollisions--;
          throw Object.assign(new Error('Failed to create record.'), {
            status: 400,
            response: { code: 400, message: 'Failed to create record.', data: { code: { code: 'validation_not_unique', message: 'Value must be unique.' } } },
          });
        }
        const now = pbNow();
        const row: Row = { approved_at: '', used_at: '', approver_ip: '', user: '', minted_hash: '', ...data, id: newId(), created: now, updated: now };
        if (typeof row.expires === 'string') row.expires = (row.expires as string).replace('T', ' ');
        rows.set(row.id, row);
        return { ...row };
      },
      async getOne(id: string) {
        const r = rows.get(id);
        if (!r) throw notFound();
        return { ...r };
      },
      async getFirstListItem(filter: string) {
        const r = [...rows.values()].find(matcher(filter));
        if (!r) throw notFound();
        return { ...r };
      },
      async getList(_page: number, perPage: number, opts: { filter?: string; sort?: string } = {}) {
        const items = [...rows.values()].filter(matcher(opts.filter)).sort(sorter(opts.sort)).slice(0, perPage);
        return { items: items.map((r) => ({ ...r })), page: 1, perPage, totalItems: items.length, totalPages: 1 };
      },
      async update(id: string, data: Record<string, unknown>) {
        const r = rows.get(id);
        if (!r) throw notFound();
        Object.assign(r, data, { updated: pbNow() });
        for (const k of ['approved_at', 'used_at']) if (typeof r[k] === 'string') r[k] = (r[k] as string).replace('T', ' ');
        return { ...r };
      },
    };
  };

  const pb = {
    filter: (expr: string, params: Record<string, unknown>) => sdk.filter(expr, params),
    collection,
    async send(path: string, opts: { method?: string; body?: Record<string, unknown> }) {
      const id = String(opts.body?.user ?? '');
      const user = users.get(id);
      if (path === '/api/ember/qr-login/mint' && opts.method === 'POST') {
        if (failNextMint) {
          const e = failNextMint;
          failNextMint = null;
          throw e;
        }
        if (!user) throw notFound();
        const token = `minted.${id}.${minted.length + 1}.${Math.random().toString(36).slice(2)}`;
        minted.push(token);
        return { token, record: { ...user, collectionName: 'users', collectionId: '_pb_users_auth_', avatar: '', theme: null, plugins: null } };
      }
      if (path === '/api/ember/qr-login/revoke-all' && opts.method === 'POST') {
        if (!user) throw notFound();
        revoked.push(id);
        return { ok: true };
      }
      throw notFound();
    },
  };

  return {
    pb,
    rows,
    users,
    minted,
    revoked,
    addUser(u: FakeUser) {
      users.set(u.id, u);
    },
    failNextMint(e: Error) {
      failNextMint = e;
    },
    collideCodes(n: number) {
      codeCollisions = n;
    },
  };
}
