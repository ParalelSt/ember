/** GET /api/version: which Ember this server runs, e.g.
 *  { "version": "0.7.31 (a1b2c3d 2026-10-22)" }. Public on purpose (the same
 *  number shows in Settings and in every bug report): `npm run host-check`
 *  compares it with main to say when the host should run ./update.sh. */
export function GET() {
  return Response.json({ version: process.env.NEXT_PUBLIC_APP_VERSION ?? null });
}
