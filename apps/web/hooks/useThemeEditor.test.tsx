import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useThemeEditor } from './useThemeEditor';
import { useThemeStore } from '@/stores/useThemeStore';
import { EMBER_INPUTS } from '@/lib/theme/presets';
import type { SavedTheme, ThemesList } from '@/lib/theme/saved';

// bughunt N1: a colour edit is lost when Appearance is left within 0.6s of
// the last drag (SAVE_DELAY_MS) — the unmount effect cleared the pending
// save timer without ever flushing it.
// bughunt N2: switching theme right after an edit could undo the switch on
// the server, because select() could fire before the flushed save landed.
// This file covers the client half of both: flush on unmount/pagehide, and
// leave() awaiting the flush before select() runs.

const api = vi.hoisted(() => ({
  listThemes: vi.fn(),
  updateSavedTheme: vi.fn(),
  createTheme: vi.fn(),
  duplicateTheme: vi.fn(),
  deleteSavedTheme: vi.fn(),
  setTheme: vi.fn(),
  getTheme: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));

const THEME_ID = 'theme0000000001';
const OTHER_ID = 'theme0000000002';

function mine(over: Partial<SavedTheme> = {}): SavedTheme {
  return {
    id: THEME_ID,
    name: 'My theme',
    base: 'ember',
    inputs: EMBER_INPUTS,
    shared: false,
    created: '2026-09-24 10:00:00',
    updated: '2026-09-24 10:00:00',
    ...over,
  };
}

function list(over: Partial<ThemesList> = {}): ThemesList {
  return { mine: [mine()], shared: [], cap: 20, ...over };
}

// A "More" colour: none of the readability pairs in lib/theme/guard.ts look
// at accentHover, so nudging it never blocks the save on an unreadable
// finding — it only matters that it differs from the saved value.
const EDITED_ACCENT_HOVER: [number, number, number] = [0.85, 0.13, 25];

/** A short real wait: enough for the promise chain a flush kicks off to
 *  reach the api call, nowhere near SAVE_DELAY_MS (600ms) — so it cannot
 *  be confused with the schedule()'d timer firing on its own. */
const settle = (ms = 20) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

beforeEach(() => {
  vi.clearAllMocks();
  useThemeStore.setState({
    doc: { v: 1, preset: 'ember', custom: EMBER_INPUTS, name: 'My theme', themeId: THEME_ID },
    preview: null,
    userId: null,
    loaded: false,
  });
  api.listThemes.mockResolvedValue(list());
  api.updateSavedTheme.mockResolvedValue({ theme: mine({ inputs: { ...EMBER_INPUTS, accentHover: EDITED_ACCENT_HOVER } }) });
});

describe('N1: a pending edit is flushed, not dropped', () => {
  it('flushes a save still waiting out SAVE_DELAY_MS when the component unmounts', async () => {
    const { result, unmount } = renderHook(() => useThemeEditor());
    await waitFor(() => expect(result.current.list).not.toBeNull());

    act(() => {
      result.current.change('accentHover', EDITED_ACCENT_HOVER);
    });
    // Well under the 600ms delay: nothing has been sent to the server yet.
    expect(api.updateSavedTheme).not.toHaveBeenCalled();

    unmount();
    await settle();

    expect(api.updateSavedTheme).toHaveBeenCalledTimes(1);
    expect(api.updateSavedTheme).toHaveBeenCalledWith(
      THEME_ID,
      expect.objectContaining({ inputs: expect.objectContaining({ accentHover: EDITED_ACCENT_HOVER }) }),
    );
  });

  it('flushes a pending save on pagehide (backgrounding / closing the tab)', async () => {
    const { result } = renderHook(() => useThemeEditor());
    await waitFor(() => expect(result.current.list).not.toBeNull());

    act(() => {
      result.current.change('accentHover', EDITED_ACCENT_HOVER);
    });
    expect(api.updateSavedTheme).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await settle();

    expect(api.updateSavedTheme).toHaveBeenCalledTimes(1);
  });
});

describe('N2: leaving waits for the flush before switching (client half)', () => {
  it('use() (switch to another theme) waits for a pending edit-save to land before selecting', async () => {
    const other: SavedTheme = mine({ id: OTHER_ID, name: 'Other theme' });
    api.listThemes.mockResolvedValue(list({ mine: [mine(), other] }));

    const order: string[] = [];
    api.updateSavedTheme.mockImplementation(async () => {
      order.push('save:start');
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('save:done');
      return { theme: mine({ inputs: { ...EMBER_INPUTS, accentHover: EDITED_ACCENT_HOVER } }) };
    });
    api.setTheme.mockImplementation(async () => {
      order.push('switch');
      return { v: 1, preset: 'ember', custom: other.inputs, name: other.name, themeId: other.id };
    });
    useThemeStore.setState({ userId: 'u1' });

    const { result } = renderHook(() => useThemeEditor());
    await waitFor(() => expect(result.current.list?.mine).toHaveLength(2));

    act(() => {
      result.current.change('accentHover', EDITED_ACCENT_HOVER);
    });
    expect(api.updateSavedTheme).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.use(other.id);
    });

    // The flushed save must finish landing before the switch's network call
    // goes out: if leave() did not await it, 'switch' could fire before
    // 'save:done', and the save could clobber the switch on the server
    // (bughunt N2).
    expect(order).toEqual(['save:start', 'save:done', 'switch']);
  });
});

describe('V10: deleting the theme in use', () => {
  it('selects the preset the server falls back to', async () => {
    api.deleteSavedTheme.mockResolvedValue({ ok: true, active: { v: 1, preset: 'midnight' } });
    const { result } = renderHook(() => useThemeEditor());
    await waitFor(() => expect(result.current.list).not.toBeNull());
    expect(result.current.selection.kind).toBe('mine');

    await act(() => result.current.remove(THEME_ID));

    expect(result.current.selection).toMatchObject({ kind: 'preset', key: 'preset:midnight' });
    expect(result.current.list?.mine).toEqual([]);
    expect(useThemeStore.getState().doc).toEqual({ v: 1, preset: 'midnight' });
  });
});
