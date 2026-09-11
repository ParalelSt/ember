import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('.', import.meta.url));

// Unit test harness. No build step, resolves the `@/` alias the app code
// uses, runs in happy-dom so component tests need no real browser.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // The repo root hoists an older React 18, and @testing-library/react
      // is hoisted up there too, so by plain node resolution RTL renders
      // React 19 elements through React 18's DOM renderer and every
      // component test throws "Objects are not valid as a React child".
      // Pin react and react-dom (and their subpaths) to apps/web's copies.
      // These must come before '@' since alias entries match in order.
      { find: /^react-dom(\/|$)/, replacement: `${webRoot}node_modules/react-dom$1` },
      { find: /^react(\/|$)/, replacement: `${webRoot}node_modules/react$1` },
      // 'server-only' isn't a real installed package: Next special-cases
      // it at build time. Any test that transitively imports a server-only
      // file (e.g. withRequestLog.ts) needs it aliased to a no-op stub.
      { find: 'server-only', replacement: `${webRoot}test-utils/serverOnlyStub.ts` },
      { find: '@', replacement: webRoot },
    ],
    dedupe: ['react', 'react-dom'],
    // Prefer ESM builds so a dependency's react import goes through the
    // aliases above instead of a CommonJS require() node resolves itself.
    mainFields: ['module', 'jsnext:main', 'jsnext', 'main', 'browser'],
  },
  test: {
    environment: 'happy-dom',
    // Process dependencies through Vite instead of externalizing them, so
    // a hoisted package's `react` import hits the aliases above rather than
    // node's own resolution (which finds the root's React 18).
    server: { deps: { inline: true } },
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
