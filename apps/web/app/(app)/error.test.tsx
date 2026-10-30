import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

/** A crash in a page is caught at the (app) segment, under the app shell's
 *  layout: the sidebar, the player bar and the menu stay, and only the
 *  page shows AppErrorBoundary's "Something broke" with a retry. */

const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), breadcrumb: vi.fn() }));
vi.mock('@/lib/logger/client', () => ({ logger }));

const { default: AppSegmentError } = await import('./error');
const { useUiStore } = await import('@/stores/useUiStore');

beforeEach(() => {
  logger.error.mockClear();
});

describe('app/(app)/error.tsx', () => {
  it('shows the app crash fallback and logs the error once', () => {
    const error = Object.assign(new Error('boom in a widget'), { digest: 'd1' });
    render(<AppSegmentError error={error} reset={vi.fn()} unstable_retry={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Something broke' })).toBeInTheDocument();
    expect(screen.getByText(/Try again, and report it/)).toBeInTheDocument();
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('react', 'boom in a widget', { digest: 'd1' }, error);
  });

  it('its button retries the page (re-fetch and re-render), not a full page reload', () => {
    const retry = vi.fn();
    const reset = vi.fn();
    render(<AppSegmentError error={new Error('x')} reset={reset} unstable_retry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it('Report a bug opens the bug dialog and retries nothing', () => {
    const retry = vi.fn();
    useUiStore.setState({ bugReportOpen: false });
    render(<AppSegmentError error={new Error('x')} reset={vi.fn()} unstable_retry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Report a bug' }));
    expect(useUiStore.getState().bugReportOpen).toBe(true);
    expect(retry).not.toHaveBeenCalled();
    useUiStore.setState({ bugReportOpen: false });
  });

  it('falls back to reset where Next passes no unstable_retry', () => {
    const reset = vi.fn();
    render(<AppSegmentError error={new Error('x')} reset={reset} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
