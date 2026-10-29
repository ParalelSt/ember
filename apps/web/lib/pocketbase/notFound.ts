/** PocketBase's "no such record": status 404 on the SDK's error. */
export function isNotFound(e: unknown): boolean {
  return (e as { status?: number } | undefined)?.status === 404;
}

/** For `.catch(nullIfNotFound)` on a read: a missing record comes back as
 *  null, and every other failure (PocketBase down, a timeout) still throws,
 *  so the route answers 5xx instead of saying the record does not exist. */
export function nullIfNotFound(e: unknown): null {
  if (isNotFound(e)) return null;
  throw e;
}
