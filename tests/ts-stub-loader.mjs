// Minimal ESM loader so unit tests can import server-side TS modules
// straight from source (e.g. lib/sources/youtube.ts, lib/trackAvailability.ts)
// without pulling in the whole Next.js build: 'server-only' only means
// anything inside webpack, and lib/logger/server needs process context this
// test never sets up. The '@/...' tsconfig path alias also means nothing to
// node's own resolver, so it's mapped to apps/web/ here, matching tsconfig.json.
const WEB_ROOT = new URL('../apps/web/', import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') {
    return { url: 'data:text/javascript,export default {};', shortCircuit: true };
  }
  if (specifier === '@/lib/logger/server') {
    return {
      url: 'data:text/javascript,export const serverLogger = { error(){}, warn(){}, info(){} };',
      shortCircuit: true,
    };
  }
  if (specifier === 'next/headers') {
    // Only createClient() (request-cookie auth) needs this; unit tests here
    // only exercise createAdminClient(), which never calls it, but the
    // static import still has to resolve to something.
    return {
      url: 'data:text/javascript,export async function cookies(){ return { getAll: () => [] }; }',
      shortCircuit: true,
    };
  }
  if (specifier.startsWith('@/')) {
    const rel = /\.[a-z]+$/.test(specifier) ? specifier.slice(2) : `${specifier.slice(2)}.ts`;
    return nextResolve(new URL(rel, WEB_ROOT).href, context);
  }
  // Plain relative imports between .ts files (e.g. lib/reports/history.ts's
  // `from './fingerprint'`) work under webpack (extension-free resolution)
  // but node's own resolver needs the real extension. Only append one when
  // the importer is itself a .ts file resolved through this loader, so a
  // relative import from a genuine .js/.mjs file is left alone.
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    !/\.[a-z]+$/.test(specifier) &&
    context.parentURL?.endsWith('.ts')
  ) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}
