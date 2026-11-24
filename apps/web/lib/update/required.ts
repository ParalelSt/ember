/** The oldest web build every client must run. A client on anything older
 *  updates itself without a tap (lib/update/apply.ts, forceWebUpdate). Served
 *  as `requiredWeb` by GET /api/version. No switch: bump this when a release
 *  must reach everyone, leave it when it need not. */
export const REQUIRED_WEB = '0.7.52';
