/** Plain x.y.z comparison, shared by the desktop update feed (server) and the
 *  changelog (client). No React, no Next, no server-only imports. */

/** "v0.2.0" / "0.2.0" -> [0,2,0]. Anything unparseable sorts lowest, so a
 *  malformed tag can never look newer than a real version. */
export function parseVersion(v: string): number[] {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec((v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}
