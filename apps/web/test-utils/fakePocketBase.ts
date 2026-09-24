import type PocketBase from 'pocketbase';
import type { RecordModel } from 'pocketbase';

/** An in-memory stand-in for the PocketBase admin client, enough for
 *  lib/tabStore.ts and the tab and theme routes: getList, getFullList,
 *  getOne, getFirstListItem, create, update, delete, and `pb.filter`, with
 *  a one-field `sort` and a lookup-by-id `expand`.
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

  /** `sort: 'field'` or `'-field'` (one field, compared as text). */
  const sorted = (items: Row[], sort?: string) => {
    if (!sort) return items;
    const desc = sort.startsWith('-');
    const field = desc ? sort.slice(1) : sort;
    return [...items].sort((a, b) => String(a[field] ?? '').localeCompare(String(b[field] ?? '')) * (desc ? -1 : 1));
  };
  /** `expand: 'a,b'`: each named field's id looked up in every table. */
  const expanded = (items: Row[], expand?: string) => {
    if (!expand) return items;
    const fields = expand.split(',').map((f) => f.trim());
    return items.map((row) => {
      const out: Record<string, unknown> = {};
      for (const f of fields) {
        const id = row[f];
        for (const list of rows.values()) {
          const hit = list.find((r) => r.id === id);
          if (hit) out[f] = hit;
        }
      }
      return { ...row, expand: { ...((row.expand as Record<string, unknown> | undefined) ?? {}), ...out } } as Row;
    });
  };

  const collection = (name: string) => ({
    async getList(page: number, perPage: number, opts: { filter?: string; sort?: string; expand?: string } = {}) {
      calls.push({ op: 'getList', collection: name, arg: opts.filter });
      const all = sorted(table(name).filter(compileFilter(opts.filter ?? '')), opts.sort);
      const items = expanded(all.slice((page - 1) * perPage, page * perPage), opts.expand);
      return { page, perPage, totalItems: all.length, totalPages: Math.max(1, Math.ceil(all.length / perPage)), items };
    },
    async getFullList(opts: { filter?: string; sort?: string; expand?: string } = {}) {
      calls.push({ op: 'getFullList', collection: name, arg: opts.filter });
      return expanded(sorted(table(name).filter(compileFilter(opts.filter ?? '')), opts.sort), opts.expand);
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
