import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ImportJob } from '@/lib/import/types';

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
}));
const { ImportBanner } = await import('./ImportBanner');

const job = (over: Partial<ImportJob>): ImportJob => ({
  id: 'j',
  playlistId: 'p',
  name: 'n',
  source: 'spotify',
  sourceUrl: '',
  coverUrl: null,
  status: 'running',
  total: 42,
  cursor: 18,
  accepted: 36,
  review: 4,
  missing: 2,
  error: null,
  retryAt: null,
  dismissed: false,
  ...over,
});

function setup(j: ImportJob, toReview = 6) {
  const cb = { onStop: vi.fn(), onRetry: vi.fn(), onReview: vi.fn(), onDismiss: vi.fn() };
  render(<ImportBanner job={j} toReview={toReview} {...cb} />);
  return cb;
}

describe('ImportBanner', () => {
  it('while running: the slim banner with count, ring and Stop', () => {
    const cb = setup(job({}));
    const b = screen.getByTestId('import-progress-banner');
    expect(b).toHaveTextContent('Importing from Spotify, 18 of 42');
    expect(b).toHaveTextContent('You can leave this page, it keeps going.');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '18');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(cb.onStop).toHaveBeenCalled();
  });

  it('a backoff pause stays in the banner and says why', () => {
    setup(job({ status: 'paused', retryAt: '2026-09-19T12:00:00Z', error: 'YouTube Music asked Ember to slow down.' }));
    expect(screen.getByTestId('import-progress-banner')).toHaveTextContent('slow down');
  });

  it('paused for good or failed: the reason and Retry', () => {
    const cb = setup(job({ status: 'failed', error: 'The import stopped because of an error.' }));
    const b = screen.getByTestId('import-error-banner');
    expect(b).toHaveTextContent('Import failed at 18 of 42');
    expect(b).toHaveTextContent('The import stopped because of an error.');
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(cb.onRetry).toHaveBeenCalled();
  });

  it('done: the counts, Review and dismiss', () => {
    const cb = setup(job({ status: 'done', cursor: 42 }));
    const s = screen.getByTestId('import-summary');
    expect(s).toHaveTextContent('Import finished');
    expect(screen.getByTestId('import-count-added')).toHaveTextContent('36 added');
    expect(screen.getByTestId('import-count-need-review')).toHaveTextContent('4 need review');
    expect(screen.getByTestId('import-count-not-found')).toHaveTextContent('2 not found');
    fireEvent.click(screen.getByRole('button', { name: /Review/ }));
    expect(cb.onReview).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(cb.onDismiss).toHaveBeenCalled();
  });

  it('nothing left to check: Review is off', () => {
    setup(job({ status: 'done', review: 0, missing: 0 }), 0);
    expect(screen.getByRole('button', { name: /Review/ })).toBeDisabled();
  });

  it('stopped by hand: says where it stopped', () => {
    setup(job({ status: 'cancelled' }));
    expect(screen.getByTestId('import-summary')).toHaveTextContent('Import stopped at 18 of 42');
  });
});
