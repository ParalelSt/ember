import { Suspense } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const replace = vi.fn();
const push = vi.fn();
const markRead = vi.fn(() => Promise.resolve());
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: React.ComponentProps<'a'>) => <a href={href} {...r}>{children}</a> }));
vi.mock('@/hooks/useChangelog', () => ({
  useChangelog: () => ({
    loaded: true,
    markRead,
    entries: [
      { id: 'n', version: '2.0.0', date: '2026-01-02', title: 'N', summary: 's', bullets: ['x'] },
      { id: 'o', version: '1.0.0', date: '2026-01-01', title: 'O', summary: 's', bullets: ['y'] },
    ],
  }),
}));

import Page from './page';

async function open(id: string) {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <Page params={Promise.resolve({ id })} />
      </Suspense>,
    );
  });
}

describe('whats-new entry route', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks the entry read on open and replaces the URL when navigating', async () => {
    await open('n');
    expect(markRead).toHaveBeenCalledWith('n');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(replace).toHaveBeenCalledWith('/whats-new/o');
  });

  it('Got it marks read and goes to the list', async () => {
    await open('o');
    markRead.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(markRead).toHaveBeenCalledWith('o');
    expect(push).toHaveBeenCalledWith('/whats-new');
  });

  it('unknown id shows the friendly state', async () => {
    await open('zzz');
    expect(screen.getByTestId('changelog-missing')).toBeInTheDocument();
  });
});
