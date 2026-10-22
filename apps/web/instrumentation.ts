/** Next's startup hook: runs once when the server boots. The work lives in
 *  instrumentation-node.ts, imported only inside this positive check: written
 *  as an early return instead, webpack still bundled the Node-only modules
 *  for the edge runtime too, and `next dev --webpack` failed on
 *  "node:child_process". Only the Node runtime has a filesystem and
 *  PocketBase access. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation-node');
    await registerNode();
  }
}
