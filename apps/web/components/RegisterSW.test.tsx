import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { RegisterSW } from './RegisterSW';

// RegisterSW clears service workers and Cache Storage on every start. The
// Origin Private File System holds pinned downloads and the auto cache of
// upcoming songs, so it must stay out of that wipe.

const unregister = vi.fn(async () => true);
const cacheDelete = vi.fn(async () => true);
const storageAccess = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RegisterSW', () => {
  it('clears service workers and Cache Storage, and never touches navigator.storage', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistrations: async () => [{ unregister }] },
    });
    vi.stubGlobal('caches', { keys: async () => ['old'], delete: cacheDelete });
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      get: () => {
        storageAccess();
        return { getDirectory: storageAccess, estimate: storageAccess, persist: storageAccess };
      },
    });

    render(<RegisterSW />);

    await waitFor(() => expect(cacheDelete).toHaveBeenCalledWith('old'));
    expect(unregister).toHaveBeenCalled();
    expect(storageAccess).not.toHaveBeenCalled();
  });
});
