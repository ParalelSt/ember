/** Same-origin (browser-reachable) URL for a PocketBase record file, built
 *  by a server route handler.
 *
 *  Server routes authenticate with the server PocketBase client
 *  (`lib/pocketbase/server.ts`), whose base URL is the internal
 *  `POCKETBASE_URL` (defaults to `http://127.0.0.1:8090`). Calling
 *  `pb.files.getURL()` on that client bakes that internal origin into the
 *  URL, which only resolves on the host machine — a browser on another
 *  device (e.g. through a tunnel) gets a broken image.
 *
 *  The browser PocketBase client (`lib/pocketbase/client.ts`) instead talks
 *  to the same-origin `/pb` proxy (see the rewrite in `next.config.ts`).
 *  This builds the exact path PocketBase's own `pb.files.getURL()` would
 *  produce — `api/files/<collectionId or name>/<recordId>/<filename>` — but
 *  rooted at `/pb` so it works from any device that can reach the app.
 *  Any server code returning a PocketBase file URL to the browser should
 *  use this instead of the server client's `pb.files.getURL()`. */

const PB_PROXY_PREFIX = '/pb';

interface FileRecord {
  id?: string;
  collectionId?: string;
  collectionName?: string;
  [key: string]: unknown;
}

/** Extra query params appended verbatim, matching PocketBase's own
 *  `FileOptions` (e.g. `{ thumb: '100x100' }`). */
export type FileUrlOptions = Record<string, string | number | boolean>;

export function fileUrl(
  record: FileRecord | null | undefined,
  filename: string | null | undefined,
  queryParams?: FileUrlOptions,
): string | null {
  if (!filename || !record?.id || (!record.collectionId && !record.collectionName)) return null;

  const collection = encodeURIComponent(record.collectionId || record.collectionName || '');
  const id = encodeURIComponent(record.id);
  const file = encodeURIComponent(filename);
  let url = `${PB_PROXY_PREFIX}/api/files/${collection}/${id}/${file}`;

  if (queryParams && Object.keys(queryParams).length > 0) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
      search.set(key, String(value));
    }
    url += `?${search.toString()}`;
  }

  return url;
}
