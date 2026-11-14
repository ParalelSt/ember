import { Suspense } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const replace = vi.fn();
const push = vi.fn();
const markRead = vi.fn(() => Promise.resolve());
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: React.ComponentProps<'a'>) => <a href={href} {...r}>{children}</a> }));
const list = vi.hoisted(() => ({
  entries: [] as { id: string; version: string; date: string; title: string; summary: string; bullets: string[] }[],
}));
const TWO = [
  { id: 'n', version: '2.0.0', date: '2026-01-02', title: 'N', summary: 's', bullets: ['x'] },
  { id: 'o', version: '1.0.0', date: '2026-01-01', title: 'O', summary: 's', bullets: ['y'] },
];
vi.mock('@/hooks/useChangelog', () => ({
  useChangelog: () => ({ loaded: true, markRead, entries: list.entries }),
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
  beforeEach(() => {
    vi.clearAllMocks();
    list.entries = TWO;
  });

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

  it("an entry further down goes back to its own page of the list", async () => {
    list.entries = Array.from({ length: 25 }, (_, i) => ({ id: `e${i}`, version: `0.${25 - i}.0`, date: '2026-01-01', title: `T${i}`, summary: 's', bullets: ['x'] }));
    await open('e13');
    expect(screen.getByTestId('changelog-back')).toHaveAttribute('href', '/whats-new?page=2');
    expect(screen.getByTestId('changelog-back-desktop')).toHaveAttribute('href', '/whats-new?page=2');
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(push).toHaveBeenCalledWith('/whats-new?page=2');
  });
});
