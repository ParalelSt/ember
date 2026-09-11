// Stub for the 'server-only' package. Next.js special-cases that import at
// build time (it isn't a real installed dependency); vitest has no such
// special case, so any test that transitively imports a file with
// `import 'server-only'` needs something resolvable. Aliased in
// vitest.config.ts.
export {};
