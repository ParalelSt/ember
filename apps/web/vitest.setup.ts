import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// RTL only auto-registers its cleanup when the test globals are exposed on
// globalThis, and this harness keeps them explicit, so unmount rendered
// trees here instead. Without it a second render in the same file finds two
// copies of the same element.
afterEach(cleanup);

// next/dynamic (the Classic look's switch points) through React.lazy: see
// test-utils/nextDynamic.tsx.
vi.mock('next/dynamic', () => import('./test-utils/nextDynamic'));
