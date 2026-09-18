import { beforeEach, describe, expect, it, vi } from 'vitest';

const getChangelog = vi.fn();
const updateChangelog = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    getChangelog: () => getChangelog(),
    updateChangelog: (patch: unknown) => updateChangelog(patch),
  },
}));

const { useChangelogStore } = await import('./useChangelogStore');
const { APP_VERSION, CHANGELOG, computeNewIds } = await import('@/lib/changelog');

const initial = useChangelogStore.getState();
const newCount = () => {
  const s = useChangelogStore.getState();
  return computeNewIds(CHANGELOG, s.seenVersion, s.hideNew).length;
};

beforeEach(() => {
  useChangelogStore.setState(initial, true);
  getChangelog.mockReset();
  updateChangelog.mockReset();
  updateChangelog.mockImplementation(async (patch: { seenVersion?: string; hideNew?: boolean }) => ({
    seenVersion: patch.seenVersion ?? '0.0.1',
    hideNew: patch.hideNew ?? false,
  }));
});

describe('useChangelogStore', () => {
  it('starts with nothing New before loading', () => {
    expect(useChangelogStore.getState().loaded).toBe(false);
    expect(newCount()).toBe(0);
  });

  it('first load with an empty field writes the current version and shows nothing New', async () => {
    getChangelog.mockResolvedValue({ seenVersion: '', hideNew: false });
    await useChangelogStore.getState().load();
    expect(updateChangelog).toHaveBeenCalledWith({ seenVersion: APP_VERSION });
    expect(useChangelogStore.getState()).toMatchObject({ seenVersion: APP_VERSION, loaded: true });
    expect(newCount()).toBe(0);
  });

  it('a load with an older seen version shows entries above it as New and writes nothing', async () => {
    getChangelog.mockResolvedValue({ seenVersion: '0.0.1', hideNew: false });
    await useChangelogStore.getState().load();
    expect(updateChangelog).not.toHaveBeenCalled();
    expect(newCount()).toBe(CHANGELOG.length);
  });

  it('markAllRead patches the current version and clears every tag', async () => {
    getChangelog.mockResolvedValue({ seenVersion: '0.0.1', hideNew: false });
    await useChangelogStore.getState().load();
    await useChangelogStore.getState().markAllRead();
    expect(updateChangelog).toHaveBeenCalledWith({ seenVersion: APP_VERSION });
    expect(useChangelogStore.getState().seenVersion).toBe(APP_VERSION);
    expect(newCount()).toBe(0);
  });

  it('markAllRead rolls back when the write fails', async () => {
    useChangelogStore.setState({ seenVersion: '0.0.1', loaded: true });
    updateChangelog.mockRejectedValue(new Error('offline'));
    await useChangelogStore.getState().markAllRead();
    expect(useChangelogStore.getState().seenVersion).toBe('0.0.1');
  });

  it('a fetch failure leaves nothing New', async () => {
    getChangelog.mockRejectedValue(new Error('offline'));
    await useChangelogStore.getState().load();
    expect(useChangelogStore.getState()).toMatchObject({ loaded: true, seenVersion: null });
    expect(newCount()).toBe(0);
    expect(updateChangelog).not.toHaveBeenCalled();
  });

  it('setHideNew saves the switch without touching the seen version', async () => {
    useChangelogStore.setState({ seenVersion: '0.0.1', loaded: true });
    await useChangelogStore.getState().setHideNew(true);
    expect(updateChangelog).toHaveBeenCalledWith({ hideNew: true });
    expect(useChangelogStore.getState()).toMatchObject({ hideNew: true, seenVersion: '0.0.1' });
    expect(newCount()).toBe(0);
  });

  it('setHideNew rolls back when the write fails', async () => {
    updateChangelog.mockRejectedValue(new Error('offline'));
    await useChangelogStore.getState().setHideNew(true);
    expect(useChangelogStore.getState().hideNew).toBe(false);
  });
});
