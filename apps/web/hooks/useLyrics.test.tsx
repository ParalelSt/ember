import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { makeTrack } from '@/test-utils/fakeBackend';
import { useQueryLyrics } from './useLyrics';
import { NO_ANSWER_MESSAGE } from '@/lib/connectionBlip';

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

  it('a Wi-Fi sign-in page in place of the server says it cannot be reached, not a JSON parse error', async () => {
    fetchSpy.mockResolvedValue(new Response('<!DOCTYPE html><p>Sign in</p>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const { result } = renderHook(() => useQueryLyrics(makeTrack(), true), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe(NO_ANSWER_MESSAGE);
  });

  it("the Funnel's 502 while the server restarts says the same", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 502 }));
    const { result } = renderHook(() => useQueryLyrics(makeTrack(), true), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe(NO_ANSWER_MESSAGE);
  });

  it("the server's own refusal keeps its sentence", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ error: 'Slow down' }), { status: 429 }));
    const { result } = renderHook(() => useQueryLyrics(makeTrack(), true), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('Slow down');
  });
});
