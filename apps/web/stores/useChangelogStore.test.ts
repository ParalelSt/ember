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
  return computeNewIds(CHANGELOG, s.seenVersion, s.hideNew, s.readIds).length;
};

beforeEach(() => {
  useChangelogStore.setState(initial, true);
  getChangelog.mockReset();
  updateChangelog.mockReset();
  updateChangelog.mockImplementation(async (patch: { seenVersion?: string; hideNew?: boolean; readIds?: string[] }) => ({
    seenVersion: patch.seenVersion ?? '0.0.1',
    hideNew: patch.hideNew ?? false,
    readIds: patch.readIds ?? [],
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
    expect(updateChangelog).toHaveBeenCalledWith({ seenVersion: APP_VERSION, readIds: [] });
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

  it('markRead clears just that entry and persists the id', async () => {
    getChangelog.mockResolvedValue({ seenVersion: '0.0.1', hideNew: false, readIds: [] });
    await useChangelogStore.getState().load();
    const id = CHANGELOG[0].id;
    await useChangelogStore.getState().markRead(id);
    expect(updateChangelog).toHaveBeenCalledWith({ readIds: [id] });
    expect(newCount()).toBe(CHANGELOG.length - 1);
  });

  it('markRead is a no-op for an already read id, an old entry, or before load', async () => {
    await useChangelogStore.getState().markRead(CHANGELOG[0].id);
    getChangelog.mockResolvedValue({ seenVersion: '0.0.1', hideNew: false, readIds: [CHANGELOG[0].id] });
    await useChangelogStore.getState().load();
    await useChangelogStore.getState().markRead(CHANGELOG[0].id);
    useChangelogStore.setState({ seenVersion: APP_VERSION, readIds: [] });
    await useChangelogStore.getState().markRead(CHANGELOG[0].id);
    expect(updateChangelog).not.toHaveBeenCalled();
  });

  it('markRead rolls back when the save fails', async () => {
    getChangelog.mockResolvedValue({ seenVersion: '0.0.1', hideNew: false, readIds: [] });
    await useChangelogStore.getState().load();
    updateChangelog.mockRejectedValueOnce(new Error('offline'));
    await useChangelogStore.getState().markRead(CHANGELOG[0].id);
    expect(newCount()).toBe(CHANGELOG.length);
  });

  it('loaded readIds keep those entries un-tagged', async () => {
    getChangelog.mockResolvedValue({ seenVersion: '0.0.1', hideNew: false, readIds: [CHANGELOG[0].id] });
    await useChangelogStore.getState().load();
    expect(newCount()).toBe(CHANGELOG.length - 1);
  });

  describe('answers that arrive out of order', () => {
    type Patch = { seenVersion?: string; hideNew?: boolean };
    /** Every write waits until the test answers it, in any order. */
    function heldWrites() {
      const held: { patch: Patch; answer: () => void; fail: () => void }[] = [];
      updateChangelog.mockImplementation(
        (patch: Patch) =>
          new Promise((resolve, reject) => {
            held.push({
              patch,
              answer: () => resolve({ seenVersion: patch.seenVersion ?? '0.0.1', hideNew: patch.hideNew ?? false }),
              fail: () => reject(new Error('offline')),
            });
          }),
      );
      return held;
    }

    it('flipping the New tags switch twice fast ends where it was flipped to', async () => {
      useChangelogStore.setState({ seenVersion: '0.0.1', loaded: true, hideNew: false });
      const held = heldWrites();
      const on = useChangelogStore.getState().setHideNew(true);
      const off = useChangelogStore.getState().setHideNew(false);
      held[1].answer();
      await off;
      held[0].answer();
      await on;
      expect(useChangelogStore.getState().hideNew).toBe(false);
    });

    it('a Mark all read reply does not put back an older New tags switch', async () => {
      useChangelogStore.setState({ seenVersion: '0.0.1', loaded: true, hideNew: false });
      const held = heldWrites();
      const read = useChangelogStore.getState().markAllRead();
      const hide = useChangelogStore.getState().setHideNew(true);
      held[1].answer();
      await hide;
      held[0].answer();
      await read;
      expect(useChangelogStore.getState().hideNew).toBe(true);
    });
  });
});
