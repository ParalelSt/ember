import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { makeTrack } from '@/test-utils/fakeBackend';
import { useQueryLyrics } from './useLyrics';

/** The lyrics request carries the track's length (bughunt X9). */

const realFetch = globalThis.fetch;
const fetchSpy = vi.fn();

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue(new Response(JSON.stringify({ lyrics: null, source: 'none', url: null })));
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('useQueryLyrics', () => {
  it('sends the track length with the lookup', async () => {
    renderHook(() => useQueryLyrics(makeTrack({ durationSec: 213 }), true), { wrapper });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const url = new URL(String(fetchSpy.mock.calls[0][0]), 'http://x');
    expect(url.searchParams.get('durationSec')).toBe('213');
  });
});
