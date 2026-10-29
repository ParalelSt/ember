import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { QueryProvider, queryRetry } from './QueryProvider';

/** A refusal (4xx) is the server's answer: asked again a second later it
 *  says the same, and a 429 asked again only meets the limit again. No
 *  answer at all, or a 5xx, gets one more try. */

const withStatus = (status: number) => Object.assign(new Error(`Request failed: ${status}`), { status });

describe('queryRetry', () => {
  it.each([400, 403, 404, 410, 429])('never asks again after a %i', (status) => {
    expect(queryRetry(0, withStatus(status))).toBe(false);
  });

  it('asks once more after a 5xx or no answer, then stops', () => {
    expect(queryRetry(0, withStatus(500))).toBe(true);
    expect(queryRetry(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(queryRetry(1, new TypeError('Failed to fetch'))).toBe(false);
  });
});

function Probe({ fn }: { fn: () => Promise<unknown> }) {
  const q = useQuery({ queryKey: ['probe'], queryFn: fn });
  return <div>{q.isError ? 'failed' : 'loading'}</div>;
}

describe('QueryProvider', () => {
  it('a rate-limited query is not sent again a second later', async () => {
    const fn = vi.fn(() => Promise.reject(withStatus(429)));
    render(<QueryProvider><Probe fn={fn} /></QueryProvider>);
    await waitFor(() => expect(screen.getByText('failed')).toBeInTheDocument(), { timeout: 3000 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
