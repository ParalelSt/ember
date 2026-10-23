import type { ComponentProps } from 'react';
import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangelogEntryPage } from './ChangelogEntryPage';
import type { ChangelogEntry } from '@/lib/changelog';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const entries: ChangelogEntry[] = [
  { id: 'b', version: '0.3.1', date: '2026-09-20', title: 'Second', summary: 's', bullets: ['two'] },
  { id: 'a', version: '0.3.0', date: '2026-09-18', title: 'First', summary: 'f', bullets: ['one'] },
];

function pointer(coarse: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: coarse && query === '(pointer: coarse)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('ChangelogEntryPage on a phone, opened directly', () => {
  // The server cannot see the pointer, so it always sends the keyboard hint;
  // the phone's first render must match that, then say Swipe.
  it('hydrates without a mismatch and then shows the swipe hint', async () => {
    pointer(false);
    const html = renderToString(<ChangelogEntryPage entry={entries[0]} entries={entries} />);
    pointer(true);
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const recoverable = vi.fn();
    await act(async () => {
      hydrateRoot(container, <ChangelogEntryPage entry={entries[0]} entries={entries} />, {
        onRecoverableError: recoverable,
      });
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Swipe for newer or older');
    container.remove();
  });
});
