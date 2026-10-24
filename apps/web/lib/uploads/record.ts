import 'server-only';
import type { RecordModel } from 'pocketbase';
import { createCatalogClient } from '@/lib/pocketbase/server';

/** An upload's row, for the stream and cover routes, read with the server's
 *  reused admin login (createCatalogClient). They signed in as admin, a
 *  password check, on every request: each Range request of a play, and
 *  every cover of a list of uploads. A login that died (the admin password
 *  changed, a restore) is replaced by the shared client itself. Null when
 *  missing. */
export async function readUpload(id: string): Promise<RecordModel | null> {
  return (await createCatalogClient()).collection('uploads').getOne(id).catch(() => null);
}
