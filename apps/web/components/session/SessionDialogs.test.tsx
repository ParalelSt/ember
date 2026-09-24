import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
}));
vi.mock('@/components/ui/input', () => ({ Input: (props: ComponentProps<'input'>) => <input {...props} /> }));
vi.mock('@/lib/api', () => ({ api: { createSession: vi.fn(), joinSession: vi.fn() } }));
vi.mock('@/hooks/useSessionHost', () => ({ startHosting: vi.fn() }));
const LONG = 'BUGHUNT Supercalifragilisticexpialidocious playlist with an extremely long name';
vi.mock('@/hooks/useLibrary', () => ({
  useQueryPlaylists: () => ({ data: [{ id: 'p1', name: LONG, created_at: '', artwork_url: null }] }),
}));

const { StartSessionDialog } = await import('./SessionDialogs');

// Bughunt V3: a select is as wide as its longest option, so a long playlist
// name pushed the dialog past the screen's edge. The select and its column
// must be allowed to shrink to the dialog (layout itself is measured by
// tests/layout-v3-session-dialog.test.mjs in a real browser).
describe('StartSessionDialog', () => {
  it('lets the playlist select shrink to the dialog instead of its longest option', () => {
    render(<StartSessionDialog open onOpenChange={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: 'Seed from playlist' });
    expect(select).toHaveTextContent(LONG);
    expect(select).toHaveClass('w-full', 'min-w-0', 'truncate');
    expect(select.parentElement).toHaveClass('min-w-0');
  });
});
