import 'server-only';
import type { RecordModel } from 'pocketbase';
import { createCatalogClient } from '@/lib/pocketbase/server';

/** An upload's row, for the stream and cover routes, read with the server's
 *  reused admin login (createCatalogClient). They signed in as admin, a
 *  password check, on every request: each Range request of a play, and
 *  every cover of a list of uploads. A row that cannot be read is asked
 *  for once more on a fresh login (the reused one dies when the admin
 *  password changes) before it counts as missing. Null when missing. */
export async function readUpload(id: string): Promise<RecordModel | null> {
  const row = await (await createCatalogClient()).collection('uploads').getOne(id).catch(() => null);
  if (row) return row;
  return (await createCatalogClient(true)).collection('uploads').getOne(id).catch(() => null);
}
