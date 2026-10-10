import { Suspense, type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

/** /link/<token> (plan 1b): the token goes to the approve sheet and leaves
 *  the address bar at once. The sheet sits over a quiet page; closing it
 *  goes Home, approving goes to Settings > Devices with the device lit. */

vi.mock('next/link', () => ({ default: ({ children, ...rest }: ComponentProps<'a'>) => <a {...rest}>{children}</a> }));
type SheetProps = { credential: unknown; onClose: () => void; onApproved: (facts: Record<string, unknown>) => void };
const seen = vi.hoisted(() => ({ credential: null as unknown, sheet: null as null | SheetProps, replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: seen.replace, push: vi.fn() }) }));
vi.mock('@/components/auth/ApproveSheet', () => ({
  ApproveSheet: (props: SheetProps) => {
    seen.credential = props.credential;
    seen.sheet = props;
    return <div data-testid="approve-sheet-stub" />;
  },
}));

const { default: ApproveLinkPage } = await import('./page');
const { useUiStore } = await import('@/stores/useUiStore');
const TOKEN = 'AbC_-'.repeat(8) + 'xyz';

async function open(token: string) {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <ApproveLinkPage params={Promise.resolve({ token })} />
      </Suspense>,
    );
  });
}

beforeEach(() => {
  seen.credential = null;
  seen.sheet = null;
  seen.replace.mockReset();
  useUiStore.setState({ justApproved: null });
  window.history.replaceState(null, '', `/link/${TOKEN}`);
});

describe('/link/[token]', () => {
  it('hands the token to the approve sheet and scrubs it from the address bar', async () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    await open(TOKEN);
    expect(seen.credential).toEqual({ token: TOKEN });
    expect(replace).toHaveBeenCalledWith(null, '', '/link');
    expect(window.location.pathname).toBe('/link');
    expect(window.location.href).not.toContain(TOKEN);
  });

  it('the sheet sits over a quiet page; closing it goes Home in place of this entry', async () => {
    await open(TOKEN);
    expect(screen.getByRole('heading', { name: 'Sign in a device' })).toBeInTheDocument();
    expect(screen.getByTestId('approve-sheet-stub')).toBeInTheDocument();
    act(() => seen.sheet!.onClose());
    expect(seen.replace).toHaveBeenCalledWith('/');
    expect(screen.queryByTestId('approve-sheet-stub')).toBeNull();
  });

  it('approving goes to Settings > Devices with the new device waiting to be lit up', async () => {
    await open(TOKEN);
    act(() => seen.sheet!.onApproved({ id: 'req1', device: 'Chrome on Windows', sameNetwork: false }));
    expect(seen.replace).toHaveBeenCalledWith('/settings/devices');
    expect(useUiStore.getState().justApproved).toMatchObject({ id: 'req1', device: 'Chrome on Windows', sameNetwork: false });
  });

  it('a malformed token never reaches the server, and points to the code input', async () => {
    await open('not-a-token');
    expect(screen.queryByTestId('approve-sheet-stub')).toBeNull();
    expect(screen.getByRole('link', { name: /Have a code/ })).toHaveAttribute('href', '/settings/devices');
    expect(window.location.pathname).toBe('/link');
  });
});
