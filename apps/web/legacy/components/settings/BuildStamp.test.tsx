import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BuildStamp } from './BuildStamp';

const version = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('@/lib/shellVersion', () => ({ shellAppVersion: () => Promise.resolve(version.value) }));

afterEach(() => {
  version.value = null;
});

describe('BuildStamp', () => {
  it('shows the web build and the app version inside a shell', async () => {
    version.value = '0.4.14';
    render(<BuildStamp build="0.7.19 (abc1234 2026-10-06)" />);
    expect(await screen.findByText(/App 0\.4\.14/)).toBeInTheDocument();
    expect(screen.getByText(/Ember build 0\.7\.19 \(abc1234 2026-10-06\)/)).toBeInTheDocument();
  });

  it('shows only the web build in a browser', async () => {
    render(<BuildStamp build="0.7.19 (abc1234 2026-10-06)" />);
    const stamp = screen.getByText(/Ember build 0\.7\.19/);
    await Promise.resolve();
    await Promise.resolve();
    expect(stamp.textContent).toBe('Ember build 0.7.19 (abc1234 2026-10-06)');
  });
});
