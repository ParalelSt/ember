import type PocketBase from 'pocketbase';
import type { RecordModel } from 'pocketbase';

/** An in-memory stand-in for the PocketBase admin client, enough for
 *  lib/tabStore.ts and the tab routes: getList, getFullList, getOne,
 *  getFirstListItem, create, update, delete, and `pb.filter`.
 *
 *  Filters are evaluated for the subset the store writes: `field = "x"`,
 *  `field != "x"`, `field ~ "x"` (contains), `field = true`, and `<`, `<=`,
 *  `>`, `>=` against a string (dates compare as text, as PocketBase's
 *  sortable date format allows), joined by
 *  `&&` / `||` with parentheses. Anything else throws, so a new filter shape
 *  shows up as a failing test rather than a silently wrong one. */

type Row = RecordModel & Record<string, unknown>;

const COMPARISON = /([A-Za-z_][A-Za-z0-9_]*)\s*(!=|>=|<=|~|=|>|<)\s*("(?:[^"\\]|\\.)*"|true|false)/g;

export function compileFilter(filter: string): (row: Row) => boolean {
  if (!filter.trim()) return () => true;
  const body = filter.replace(COMPARISON, (_m, field: string, op: string, raw: string) => {
    const value = raw === 'true' ? 'true' : raw === 'false' ? 'false' : raw;
    return `__cmp(row[${JSON.stringify(field)}], ${JSON.stringify(op)}, ${value})`;
  });
  if (/[^\s()&|]/.test(body.replace(/__cmp\((?:[^()"]|"(?:[^"\\]|\\.)*")*\)/g, ''))) {
    throw new Error(`fake PocketBase cannot evaluate filter: ${filter}`);
  }
  const cmp = (a: unknown, op: string, b: unknown) => {
    const left = a ?? (typeof b === 'boolean' ? false : '');
    if (op === '=') return left === b;
    if (op === '!=') return left !== b;
    if (op === '<') return String(left) < String(b);
    if (op === '<=') return String(left) <= String(b);
    if (op === '>') return String(left) > String(b);
    if (op === '>=') return String(left) >= String(b);
    return String(left).toLowerCase().includes(String(b).toLowerCase());
  };
  const fn = new Function('row', '__cmp', `return (${body});`) as (row: Row, c: typeof cmp) => boolean;
  return (row) => fn(row, cmp);
}

let seq = 0;

export interface FakePb {
  pb: PocketBase;
  rows: Map<string, Row[]>;
  calls: { op: string; collection: string; arg?: unknown }[];
}

export function fakePocketBase(initial: Record<string, Partial<Row>[]> = {}): FakePb {
  const rows = new Map<string, Row[]>();
  for (const [name, list] of Object.entries(initial)) {
    rows.set(name, list.map((r) => ({ collectionId: name, collectionName: name, created: '', ...r }) as Row));
  }
  const calls: FakePb['calls'] = [];
  const table = (name: string) => {
    if (!rows.has(name)) rows.set(name, []);
    return rows.get(name)!;
  };
  const notFound = () => Object.assign(new Error('not found'), { status: 404 });

  const collection = (name: string) => ({
    async getList(page: number, perPage: number, opts: { filter?: string; sort?: string } = {}) {
      calls.push({ op: 'getList', collection: name, arg: opts.filter });
      let items = table(name).filter(compileFilter(opts.filter ?? ''));
      if (opts.sort === '-created') items = [...items].sort((a, b) => String(b.created).localeCompare(String(a.created)));
      items = items.slice((page - 1) * perPage, page * perPage);
      return { page, perPage, totalItems: items.length, totalPages: 1, items };
    },
    async getFullList(opts: { filter?: string } = {}) {
      calls.push({ op: 'getFullList', collection: name, arg: opts.filter });
      return table(name).filter(compileFilter(opts.filter ?? ''));
    },
    async getFirstListItem(filter: string) {
      calls.push({ op: 'getFirstListItem', collection: name, arg: filter });
      const hit = table(name).find(compileFilter(filter));
      if (!hit) throw notFound();
      return hit;
    },
    async getOne(id: string) {
      calls.push({ op: 'getOne', collection: name, arg: id });
      const hit = table(name).find((r) => r.id === id);
      if (!hit) throw notFound();
      return hit;
    },
    async create(data: Record<string, unknown>) {
      calls.push({ op: 'create', collection: name, arg: data });
      seq += 1;
      const row = {
        id: `rec${String(seq).padStart(12, '0')}`,
        collectionId: name,
        collectionName: name,
        created: new Date(Date.UTC(2026, 8, 18, 12, 0, seq)).toISOString(),
        ...data,
      } as Row;
      table(name).push(row);
      return row;
    },
    async update(id: string, patch: Record<string, unknown>) {
      calls.push({ op: 'update', collection: name, arg: { id, patch } });
      const row = table(name).find((r) => r.id === id);
      if (!row) throw notFound();
      Object.assign(row, patch);
      return row;
    },
    async delete(id: string) {
      calls.push({ op: 'delete', collection: name, arg: id });
      const list = table(name);
      const i = list.findIndex((r) => r.id === id);
      if (i < 0) throw notFound();
      list.splice(i, 1);
      return true;
    },
  });

  const pb = {
    collection,
    filter(expr: string, params: Record<string, unknown> = {}) {
      return expr.replace(/\{:(\w+)\}/g, (_m, k: string) => {
        const v = params[k];
        return typeof v === 'string' ? JSON.stringify(v) : String(v);
      });
    },
  } as unknown as PocketBase;

  return { pb, rows, calls };
}
