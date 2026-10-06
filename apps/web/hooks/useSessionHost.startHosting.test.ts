import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { mergeIntoPlayerQueue } from '@/lib/carlist';
import { makeTrack } from '@/test-utils/fakeBackend';

vi.mock('@/components/player/PlayerProvider', () => ({ usePlayer: () => ({ next: vi.fn(), current: null }) }));
vi.mock('@/lib/api', () => ({ api: {} }));

const { startHosting } = await import('./useSessionHost');

/** Starting a carlist while your own music is queued (bughunt X5): the
 *  group's songs have to come right after the song playing, not after the
 *  rest of your old queue, and a guest's Skip must only skip the song in
 *  front of everyone. */
const mine1 = makeTrack({ id: 'youtube:m1', sourceId: 'm1', title: 'Mine 1' });
const mine2 = makeTrack({ id: 'youtube:m2', sourceId: 'm2', title: 'Mine 2' });
const mine3 = makeTrack({ id: 'youtube:m3', sourceId: 'm3', title: 'Mine 3' });
const a = makeTrack({ id: 'youtube:a', sourceId: 'a', title: 'A' });
const b = makeTrack({ id: 'youtube:b', sourceId: 'b', title: 'B' });

beforeEach(() => {
  useSessionStore.setState({ hostingSessionId: null });
});

describe('startHosting', () => {
  it('drops the leftover queue but keeps the playing song', () => {
    usePlayerStore.setState({ queue: [mine1, mine2, mine3], index: 1, shuffle: true, orderBackup: [mine3, mine1, mine2], baseCount: 3 });
    startHosting('s1');
    const st = usePlayerStore.getState();
    expect(st.queue.map((t) => t.id)).toEqual(['youtube:m2']);
    expect(st.index).toBe(0);
    // Turning shuffle off must not bring the old queue back.
    expect(st.shuffle).toBe(false);
    expect(st.orderBackup).toBeNull();
    expect(st.baseCount).toBe(0);
    expect(useSessionStore.getState().hostingSessionId).toBe('s1');
  });

  it("puts the group's songs right after the playing song once the host mirrors them", () => {
    usePlayerStore.setState({ queue: [mine1, mine2, mine3], index: 1 });
    startHosting('s1');
    const { queue, index } = usePlayerStore.getState();
    const merged = mergeIntoPlayerQueue(queue, index, [a, b]);
    expect(merged?.queue.map((t) => t.id)).toEqual(['youtube:m2', 'youtube:a', 'youtube:b']);
    expect(merged?.index).toBe(0);
  });

  it('with nothing playing, starts from an empty queue', () => {
    usePlayerStore.setState({ queue: [], index: -1 });
    startHosting('s1');
    expect(usePlayerStore.getState()).toMatchObject({ queue: [], index: -1 });
  });
});
