import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useThemeEditor } from './useThemeEditor';
import { useThemeStore } from '@/stores/useThemeStore';
import { EMBER_INPUTS } from '@/lib/theme/presets';
import type { SavedTheme, ThemesList } from '@/lib/theme/saved';

// bughunt N1: a colour edit is lost when Appearance is left within 0.6s of
// the last drag (SAVE_DELAY_MS) — the unmount effect cleared the pending
// save timer without ever flushing it.

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
