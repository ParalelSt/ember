/** Escapes text for a double-quoted PocketBase filter string. PB filter
 *  strings interpolate raw, so user-controlled text goes through this. */
export function escapeFilterValue(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
