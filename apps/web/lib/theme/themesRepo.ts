import 'server-only';
import type PocketBase from 'pocketbase';
import { createAdminClient } from '@/lib/pocketbase/server';
import { isPresetId, validateInputs, type PresetId, type ThemeInputs } from '@/lib/theme/model';
import type { SavedTheme, SharedTheme } from '@/lib/theme/saved';

/** The `themes` collection, through the admin client: the collection's
 *  write rules are null (pb_hooks/ensure_themes.pb.js), so the routes are
 *  the only writers and they check ownership themselves. Kept to plain
 *  reads and writes so the routes' logic tests against an in-memory fake. */

export interface ThemeRow {
  id: string;
  owner: string;
  name: string;
  base: PresetId;
  inputs: ThemeInputs;
  shared: boolean;
  created: string;
  updated: string;
}

export interface NewThemeRow {
  owner: string;
  name: string;
  base: PresetId;
  inputs: ThemeInputs;
  shared: boolean;
}

export type ThemeRowPatch = Partial<Pick<ThemeRow, 'name' | 'base' | 'inputs' | 'shared'>>;

export interface ThemesRepo {
  /** Null when there is no such row. */
  get(id: string): Promise<ThemeRow | null>;
  listMine(owner: string): Promise<ThemeRow[]>;
  /** Everyone else's shared rows, newest first, with the creator's name. */
  listShared(exceptOwner: string): Promise<(ThemeRow & { ownerName: string })[]>;
  countMine(owner: string): Promise<number>;
  create(row: NewThemeRow): Promise<ThemeRow>;
  update(id: string, patch: ThemeRowPatch): Promise<ThemeRow>;
  remove(id: string): Promise<void>;
}

/** How many shared themes the community list shows. */
const SHARED_LIMIT = 200;

function toRow(rec: Record<string, unknown>): ThemeRow | null {
  const inputs = validateInputs(rec.inputs);
  if (!inputs.ok || !isPresetId(rec.base)) return null;
  return {
    id: String(rec.id),
    owner: String(rec.owner ?? ''),
    name: String(rec.name ?? ''),
    base: rec.base,
    inputs: inputs.inputs,
    shared: rec.shared === true,
    created: String(rec.created ?? ''),
    updated: String(rec.updated ?? ''),
  };
}

function mustRow(rec: Record<string, unknown>): ThemeRow {
  const row = toRow(rec);
  if (!row) throw Object.assign(new Error('Stored theme is unreadable'), { status: 500 });
  return row;
}

export function repoFor(pb: PocketBase): ThemesRepo {
  const themes = () => pb.collection('themes');
  return {
    async get(id) {
      try {
        return toRow(await themes().getOne(id));
      } catch (e) {
        if ((e as { status?: number }).status === 404) return null;
        throw e;
      }
    },
    async listMine(owner) {
      const recs = await themes().getFullList({ filter: pb.filter('owner = {:owner}', { owner }), sort: 'created' });
      return recs.map(toRow).filter((r): r is ThemeRow => r !== null);
    },
    async listShared(exceptOwner) {
      const page = await themes().getList(1, SHARED_LIMIT, {
        filter: pb.filter('shared = true && owner != {:me}', { me: exceptOwner }),
        sort: '-updated',
        expand: 'owner',
      });
      return page.items.flatMap((rec) => {
        const row = toRow(rec);
        if (!row) return [];
        const owner = (rec.expand?.owner ?? null) as { name?: unknown } | null;
        const ownerName = typeof owner?.name === 'string' && owner.name.trim() ? owner.name.trim() : 'Someone';
        return [{ ...row, ownerName }];
      });
    },
    async countMine(owner) {
      const page = await themes().getList(1, 1, { filter: pb.filter('owner = {:owner}', { owner }), skipTotal: false });
      return page.totalItems;
    },
    async create(row) {
      return mustRow(await themes().create(row));
    },
    async update(id, patch) {
      return mustRow(await themes().update(id, patch));
    },
    async remove(id) {
      await themes().delete(id);
    },
  };
}

export async function openThemesRepo(): Promise<ThemesRepo> {
  return repoFor(await createAdminClient());
}

export function toSaved(row: ThemeRow): SavedTheme {
  return {
    id: row.id,
    name: row.name,
    base: row.base,
    inputs: row.inputs,
    shared: row.shared,
    created: row.created,
    updated: row.updated,
  };
}

export function toShared(row: ThemeRow & { ownerName: string }): SharedTheme {
  return { id: row.id, name: row.name, base: row.base, inputs: row.inputs, ownerName: row.ownerName, updated: row.updated };
}
