import { describe, expect, it } from 'vitest';
import { newestLikedJob } from '@/hooks/useImports';
import type { ImportJob } from '@/lib/import/types';

const job = (over: Partial<ImportJob>): ImportJob => ({
  id: 'j',
  userId: 'u1',
  kind: 'playlist',
  playlistId: 'p1',
  name: 'n',
  source: 'spotify',
  sourceUrl: '',
  coverUrl: null,
  status: 'done',
  total: 1,
  cursor: 1,
  accepted: 1,
  review: 0,
  missing: 0,
  existing: 0,
  error: null,
  retryAt: null,
  dismissed: false,
  ...over,
});

// Which job the Liked page reports on. The list arrives newest first.
describe('newestLikedJob', () => {
  it('takes the newest transfer and ignores playlist imports', () => {
    const jobs = [
      job({ id: 'p', kind: 'playlist' }),
      job({ id: 'newest', kind: 'liked', playlistId: null }),
      job({ id: 'older', kind: 'liked', playlistId: null }),
    ];
    expect(newestLikedJob(jobs)?.id).toBe('newest');
  });

  it('skips a transfer the person dismissed, and falls through to the one before it', () => {
    const jobs = [
      job({ id: 'gone', kind: 'liked', playlistId: null, dismissed: true }),
      job({ id: 'still here', kind: 'liked', playlistId: null }),
    ];
    expect(newestLikedJob(jobs)?.id).toBe('still here');
  });

  it('no transfer at all: nothing on the page', () => {
    expect(newestLikedJob([job({ kind: 'playlist' })])).toBeNull();
    expect(newestLikedJob([])).toBeNull();
  });
});
