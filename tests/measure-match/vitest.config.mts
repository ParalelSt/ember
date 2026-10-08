// Run from apps/web:
//   PYTHON_BIN=<repo venv python> npx vitest run --config ../../tests/measure-match/vitest.config.mts
// Kept out of the normal `npx vitest run` on purpose: it makes real
// YouTube Music searches (anonymous, no account, no cookies).
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import base from '../../apps/web/vitest.config';

const here = fileURLToPath(new URL('.', import.meta.url));

// Not mergeConfig: it would concatenate `include` and run the whole suite.
export default defineConfig({
  ...base,
  root: fileURLToPath(new URL('../../apps/web', import.meta.url)),
  test: {
    ...base.test,
    include: [`${here}measure.measure.ts`],
    testTimeout: 30 * 60_000,
  },
});
