import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { StorageBar } from './StorageBar';

const setEstimate = (fn: unknown) => {
  Object.defineProperty(navigator, 'storage', { value: fn ? { estimate: fn } : undefined, configurable: true });
};
afterEach(() => setEstimate(undefined));

describe('StorageBar', () => {
  it('shows the total, both parts in the key, and no free text without an estimate', () => {
    setEstimate(undefined);
    render(<StorageBar downloadsBytes={150 * 1024 * 1024} cacheBytes={42 * 1024 * 1024} canEstimate />);
    expect(screen.getByTestId('storage-total')).toHaveTextContent('192.0 MB');
    expect(screen.getByText(/Downloads 150\.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/Automatic cache 42\.0 MB/)).toBeInTheDocument();
    expect(screen.queryByTestId('storage-free')).toBeNull();
    expect(screen.getByTestId('storage-seg-downloads').style.width).toMatch(/^78\.1/);
  });

  it('shows free space and scales to the quota when the browser knows it', async () => {
    const GB = 1024 ** 3;
    setEstimate(vi.fn(async () => ({ quota: 10 * GB, usage: 2 * GB })));
    render(<StorageBar downloadsBytes={GB / 2} cacheBytes={GB / 2} canEstimate />);
    await waitFor(() => expect(screen.getByTestId('storage-free')).toHaveTextContent('8.00 GB free'));
    expect(parseFloat(screen.getByTestId('storage-seg-downloads').style.width)).toBeCloseTo(5);
  });

  it('ignores the estimate in the native shell', () => {
    const est = vi.fn(async () => ({ quota: 1e9, usage: 0 }));
    setEstimate(est);
    render(<StorageBar downloadsBytes={10} cacheBytes={10} canEstimate={false} />);
    expect(est).not.toHaveBeenCalled();
    expect(screen.queryByTestId('storage-free')).toBeNull();
  });
});
