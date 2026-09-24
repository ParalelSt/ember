import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeDoc } from '@/lib/theme/model';
import { PRESET_BY_ID } from '@/lib/theme/presets';

const getTheme = vi.fn();
const setTheme = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    getTheme: () => getTheme(),
    setTheme: (selection: unknown) => setTheme(selection),
  },
}));

const { useThemeStore, registerThemeCookieWriter } = await import('./useThemeStore');

const initial = useThemeStore.getState();
const stored = () => JSON.parse(window.localStorage.getItem('ember.theme.v1') ?? '{}').state;
const cookie = vi.fn();
const SAVED: ThemeDoc = {
  v: 1,
  preset: 'forest',
  custom: PRESET_BY_ID.forest.inputs,
  name: 'Late shift',
  themeId: 'abcdefghij12345',
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  useThemeStore.setState(initial, true);
  window.localStorage.clear();
  getTheme.mockReset();
  setTheme.mockReset();
  cookie.mockReset();
  registerThemeCookieWriter(cookie);
  setTheme.mockImplementation(async (sel: { preset?: string; themeId?: string }) =>
    sel.preset ? { v: 1, preset: sel.preset } : SAVED,
  );
});

describe('useThemeStore', () => {
  it('starts on Ember and persists only the doc', async () => {
    expect(useThemeStore.getState().doc).toEqual({ v: 1, preset: 'ember' });
    useThemeStore.setState({ userId: 'u1' });
    await useThemeStore.getState().select({ preset: 'mono' });
    expect(stored()).toEqual({ doc: { v: 1, preset: 'mono' } });
  });

  it('applies a preset at once, saves it and refreshes the cookie', async () => {
    useThemeStore.setState({ userId: 'u1' });
    const saving = useThemeStore.getState().select({ preset: 'midnight' });
    expect(useThemeStore.getState().doc).toEqual({ v: 1, preset: 'midnight' });
    expect(await saving).toEqual({ v: 1, preset: 'midnight' });
    expect(setTheme).toHaveBeenCalledWith({ preset: 'midnight' });
    expect(cookie).toHaveBeenCalledWith({ v: 1, preset: 'midnight' });
  });

  it('applies a saved theme optimistically when given the doc, else after the save', async () => {
    useThemeStore.setState({ userId: 'u1' });
    const withGuess = useThemeStore.getState().select({ themeId: SAVED.themeId! }, SAVED);
    expect(useThemeStore.getState().doc).toEqual(SAVED);
    await withGuess;
    useThemeStore.setState({ doc: { v: 1, preset: 'ember' } });
    const pending = useThemeStore.getState().select({ themeId: SAVED.themeId! });
    expect(useThemeStore.getState().doc).toEqual({ v: 1, preset: 'ember' });
    await pending;
    expect(useThemeStore.getState().doc).toEqual(SAVED);
  });

  it('rolls back a failed save, but not over a newer choice', async () => {
    useThemeStore.setState({ userId: 'u1', doc: { v: 1, preset: 'forest' } });
    setTheme.mockRejectedValueOnce(new Error('offline'));
    expect(await useThemeStore.getState().select({ preset: 'nebula' })).toBeNull();
    expect(useThemeStore.getState().doc).toEqual({ v: 1, preset: 'forest' });
    expect(cookie).not.toHaveBeenCalled();

    const slow = deferred<ThemeDoc>();
    setTheme.mockReturnValueOnce(slow.promise);
    const first = useThemeStore.getState().select({ preset: 'nebula' });
    await useThemeStore.getState().select({ preset: 'mono' });
    slow.reject(new Error('offline'));
    await first;
    expect(useThemeStore.getState().doc).toEqual({ v: 1, preset: 'mono' });
  });

  it('a late success does not replace a newer choice', async () => {
    useThemeStore.setState({ userId: 'u1' });
    const slow = deferred<ThemeDoc>();
    setTheme.mockReturnValueOnce(slow.promise);
    const first = useThemeStore.getState().select({ preset: 'nebula' });
    await useThemeStore.getState().select({ preset: 'mono' });
    slow.resolve({ v: 1, preset: 'nebula' });
    await first;
    expect(useThemeStore.getState().doc).toEqual({ v: 1, preset: 'mono' });
  });

  it('signed out, a choice stays on this device', async () => {
    expect(await useThemeStore.getState().select({ preset: 'forest' })).toEqual({ v: 1, preset: 'forest' });
    expect(setTheme).not.toHaveBeenCalled();
    expect(useThemeStore.getState().doc).toEqual({ v: 1, preset: 'forest' });
  });

  it("loads the account's theme once per user and refreshes the cookie", async () => {
    getTheme.mockResolvedValue(SAVED);
    await useThemeStore.getState().loadTheme('u1');
    await useThemeStore.getState().loadTheme('u1');
    expect(getTheme).toHaveBeenCalledTimes(1);
    expect(useThemeStore.getState()).toMatchObject({ doc: SAVED, loaded: true, userId: 'u1' });
    expect(cookie).toHaveBeenCalledWith(SAVED);
  });

  it('keeps the cache when the load fails', async () => {
    useThemeStore.setState({ doc: { v: 1, preset: 'mono' } });
    getTheme.mockRejectedValue(new Error('offline'));
    await useThemeStore.getState().loadTheme('u1');
    expect(useThemeStore.getState().doc).toEqual({ v: 1, preset: 'mono' });
    expect(useThemeStore.getState().loaded).toBe(false);
  });

  it('does not let a load overwrite a choice made while it was in flight', async () => {
    const slow = deferred<ThemeDoc>();
    getTheme.mockReturnValue(slow.promise);
    const loading = useThemeStore.getState().loadTheme('u1');
    await useThemeStore.getState().select({ preset: 'nebula' });
    slow.resolve({ v: 1, preset: 'forest' });
    await loading;
    expect(useThemeStore.getState().doc).toEqual({ v: 1, preset: 'nebula' });
  });

  it('drops a load for a user who already signed out', async () => {
    const slow = deferred<ThemeDoc>();
    getTheme.mockReturnValue(slow.promise);
    const loading = useThemeStore.getState().loadTheme('u1');
    useThemeStore.getState().resetThemeSync();
    slow.resolve({ v: 1, preset: 'forest' });
    await loading;
    expect(useThemeStore.getState().doc).toEqual({ v: 1, preset: 'ember' });
  });

  it('sign-out keeps the cached theme and drops any draft', async () => {
    useThemeStore.setState({ userId: 'u1', loaded: true, doc: SAVED, preview: { v: 1, preset: 'mono' } });
    useThemeStore.getState().resetThemeSync();
    expect(useThemeStore.getState()).toMatchObject({ userId: null, loaded: false, preview: null, doc: SAVED });
  });

  it('a server-painted doc wins over the cache; null leaves the cache', () => {
    useThemeStore.setState({ doc: { v: 1, preset: 'mono' } });
    useThemeStore.getState().hydrateFromServer(null);
    expect(useThemeStore.getState().doc).toEqual({ v: 1, preset: 'mono' });
    useThemeStore.getState().hydrateFromServer(SAVED);
    expect(useThemeStore.getState().doc).toEqual(SAVED);
  });

  it('adopts a doc a themes call returned, cookie included', () => {
    useThemeStore.getState().adopt(SAVED);
    expect(useThemeStore.getState().doc).toEqual(SAVED);
    expect(cookie).toHaveBeenCalledWith(SAVED);
  });

  it('reads a junk cache back as the default', async () => {
    window.localStorage.setItem('ember.theme.v1', JSON.stringify({ state: { doc: { v: 9, preset: 'x' } }, version: 0 }));
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().doc).toEqual({ v: 1, preset: 'ember' });
    window.localStorage.setItem('ember.theme.v1', JSON.stringify({ state: { doc: { v: 1, preset: 'nebula' } }, version: 0 }));
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().doc).toEqual({ v: 1, preset: 'nebula' });
  });

  it('a throwing cookie writer never breaks a save', async () => {
    registerThemeCookieWriter(() => {
      throw new Error('boom');
    });
    useThemeStore.setState({ userId: 'u1' });
    expect(await useThemeStore.getState().select({ preset: 'mono' })).toEqual({ v: 1, preset: 'mono' });
  });
});
