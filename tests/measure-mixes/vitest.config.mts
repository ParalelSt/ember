// Run from apps/web:
//   MIX_SIM_DIR=<export dir> ../../node_modules/.bin/vitest run --config ../../tests/measure-mixes/vitest.config.mts
// Kept out of the normal `vitest run` on purpose: with MIX_SIM_FETCH=1 or
// MIX_SIM_LOOKUPS=1 it makes real YouTube Music and MusicBrainz calls.
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
    environment: 'node',
    include: [`${here}measure.measure.ts`],
    testTimeout: 120 * 60_000,
  },
});
