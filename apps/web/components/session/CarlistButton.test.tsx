import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

// base-ui's Dialog cannot run under the unit tests' React (test-utils/
// dialogMock.tsx): the stand-in hands over onOpenChange, which is what the
// scrim and Escape call.
const h = vi.hoisted(() => ({ dismiss: null as null | ((open: boolean) => void) }));
vi.mock('@/components/ui/sheet', async () => {
  const real = await import('@/test-utils/dialogMock');
  return {
    ...real,
    Sheet: (props: ComponentProps<typeof real.Sheet>) => {
      h.dismiss = props.onOpenChange ?? null;
      return <real.Sheet {...props} />;
    },
  };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/session/SessionDialogs', () => ({
  StartSessionDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="start-dialog" /> : null),
  JoinSessionDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="join-dialog" /> : null),
}));
const live = vi.hoisted(() => ({ data: null as null | { id: string; code: string; name: string; isHost: boolean } }));
vi.mock('@/hooks/useSession', () => ({ useQueryLiveCarlist: () => ({ data: live.data }) }));

const { CarlistButton } = await import('./CarlistButton');

beforeEach(() => {
  live.data = null;
});

const open = () => fireEvent.click(screen.getByTestId('carlist-entry'));

describe('CarlistButton (Your library)', () => {
  it('nothing live: an icon-only squircle button labelled Carlist, no sheet yet', () => {
    render(<CarlistButton />);
    const btn = screen.getByTestId('carlist-entry');
    expect(btn).toHaveAttribute('aria-label', 'Carlist');
    expect(btn).toHaveAttribute('data-shape', 'squircle');
    expect(btn.className).toContain('rounded-[32%]');
    expect(btn.className).toContain('size-11');
    expect(btn.textContent).toBe('');
    expect(screen.queryByTestId('carlist-sheet')).toBeNull();
  });

  it('tapping it opens the Carlist sheet with both option cards', async () => {
    render(<CarlistButton />);
    open();
    const sheet = await screen.findByTestId('carlist-sheet');
    expect(sheet).toHaveTextContent('Carlist');
    expect(screen.getByTestId('carlist-start')).toHaveTextContent('Start a carlist');
    expect(screen.getByTestId('carlist-start')).toHaveTextContent('Share a list friends can add songs to in the car');
    expect(screen.getByTestId('carlist-join')).toHaveTextContent('Join a carlist');
    expect(screen.getByTestId('carlist-join')).toHaveTextContent('Scan or enter a code');
  });

  it('Start a carlist opens today’s Start dialog and closes the sheet', async () => {
    render(<CarlistButton />);
    open();
    fireEvent.click(await screen.findByTestId('carlist-start'));
    expect(screen.getByTestId('start-dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('join-dialog')).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('carlist-sheet')).toBeNull());
  });

  it('Join a carlist opens the Join dialog', async () => {
    render(<CarlistButton />);
    open();
    fireEvent.click(await screen.findByTestId('carlist-join'));
    expect(screen.getByTestId('join-dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('start-dialog')).toBeNull();
  });

  it('Escape or the scrim (onOpenChange false) closes the sheet without opening a dialog', async () => {
    render(<CarlistButton />);
    open();
    await screen.findByTestId('carlist-sheet');
    act(() => h.dismiss?.(false));
    await waitFor(() => expect(screen.queryByTestId('carlist-sheet')).toBeNull());
    expect(screen.queryByTestId('start-dialog')).toBeNull();
    expect(screen.queryByTestId('join-dialog')).toBeNull();
  });

  it('Back closes the sheet', async () => {
    render(<CarlistButton />);
    open();
    await screen.findByTestId('carlist-sheet');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(screen.queryByTestId('carlist-sheet')).toBeNull());
  });

  it('a live carlist: "Live · CODE", and it opens that carlist', () => {
    live.data = { id: 's1', code: 'K7MPQ4', name: 'Road trip', isHost: false };
    render(<CarlistButton />);
    const link = screen.getByTestId('carlist-live');
    expect(link).toHaveTextContent('Live · K7MPQ4');
    expect(link).toHaveAttribute('href', '/session/s1');
    expect(screen.queryByTestId('carlist-entry')).toBeNull();
  });
});
