import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useThemeEditor } from './useThemeEditor';
import { useThemeStore } from '@/stores/useThemeStore';
import { EMBER_INPUTS, PRESET_BY_ID } from '@/lib/theme/presets';
import { docFromSaved, type SavedTheme, type ThemesList } from '@/lib/theme/saved';
import type { ThemeDoc } from '@/lib/theme/model';

// Feature F1 (docs/reports/bughunt-2026-09-24/F1-theme-apply-button.md):
// picking a theme or changing a colour is a draft shown only in the page's
// preview; Apply is the one thing that saves it and makes it the active
// theme. This file covers the hook's half: what each action sends (or does
// not), Discard, leaving the page, the readability block, and the two
// bughunt cases that still hold under the new flow:
// bughunt N1: leaving Appearance used to flush a waiting autosave. There is
// no autosave now, and the owner asked that leaving applies nothing: the
// draft stays in memory for the session instead.
// bughunt N2: a switch must not overtake a save of colours still in flight,
// or the late save puts back the theme just moved off. Applies run one
// after another.

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
const NEW_ID = 'theme0000000003';

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
// at accentHover, so nudging it never trips the guard; it only matters that
// it differs from the saved value.
const EDITED_ACCENT_HOVER: [number, number, number] = [0.85, 0.13, 25];
// The accent pushed onto the background: links unreadable, a `fail`.
const MURKY_ACCENT: [number, number, number] = [0.2, 0.02, 260];

const ACTIVE_MINE: ThemeDoc = docFromSaved(mine());

/** A short real wait for promise chains, nowhere near any timer. */
const settle = (ms = 20) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

const noServerCalls = () => {
  expect(api.setTheme).not.toHaveBeenCalled();
  expect(api.updateSavedTheme).not.toHaveBeenCalled();
  expect(api.createTheme).not.toHaveBeenCalled();
};

async function mounted() {
  const hook = renderHook(() => useThemeEditor());
  await waitFor(() => expect(hook.result.current.list).not.toBeNull());
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  useThemeStore.setState({ doc: ACTIVE_MINE, draft: null, userId: 'u1', loaded: true });
  api.listThemes.mockResolvedValue(list());
  api.updateSavedTheme.mockImplementation(async (id: string, patch: Partial<SavedTheme>) => {
    const theme = { ...mine(), id, ...patch };
    const active = useThemeStore.getState().doc.themeId === id ? docFromSaved(theme) : undefined;
    return { theme, ...(active ? { active } : {}) };
  });
  api.createTheme.mockImplementation(async (body: Pick<SavedTheme, 'name' | 'base' | 'inputs'>) => ({
    theme: mine({ id: NEW_ID, ...body }),
  }));
  api.setTheme.mockImplementation(async (sel: { preset?: string; themeId?: string }) =>
    sel.preset ? { v: 1, preset: sel.preset } : { ...ACTIVE_MINE, themeId: sel.themeId },
  );
});

describe('F1: a pick or an edit is a draft, shown only in the preview', () => {
  it('picking a preset changes what the page shows, not the active theme, and sends nothing', async () => {
    const { result } = await mounted();
    act(() => result.current.pickPreset('midnight'));

    expect(result.current.selection).toMatchObject({ kind: 'preset', key: 'preset:midnight' });
    expect(result.current.inputs).toEqual(PRESET_BY_ID.midnight.inputs);
    expect(result.current.dirty).toBe(true);
    expect(result.current.canApply).toBe(true);
    expect(result.current.active).toMatchObject({ kind: 'mine', key: THEME_ID });
    expect(useThemeStore.getState().doc).toEqual(ACTIVE_MINE);
    expect(useThemeStore.getState().draft?.target).toEqual({ v: 1, preset: 'midnight' });
    noServerCalls();
  });

  it('a colour edit changes the draft only', async () => {
    const { result } = await mounted();
    act(() => result.current.change('accentHover', EDITED_ACCENT_HOVER));

    expect(result.current.inputs.accentHover).toEqual(EDITED_ACCENT_HOVER);
    expect(result.current.edited).toBe(true);
    expect(useThemeStore.getState().doc).toEqual(ACTIVE_MINE);
    await settle(700); // well past the old 600 ms autosave
    noServerCalls();
  });

  it('picking the theme already in use again leaves nothing to apply', async () => {
    const { result } = await mounted();
    act(() => result.current.pickPreset('forest'));
    act(() => result.current.use(THEME_ID));
    expect(result.current.dirty).toBe(false);
    expect(useThemeStore.getState().draft).toBeNull();
  });
});

describe('F1: Apply saves and applies', () => {
  it('a preset as it is: selected on the account, nothing else saved', async () => {
    const { result } = await mounted();
    act(() => result.current.pickPreset('midnight'));
    await act(() => result.current.apply());

    expect(api.setTheme).toHaveBeenCalledWith({ preset: 'midnight' });
    expect(api.createTheme).not.toHaveBeenCalled();
    expect(useThemeStore.getState().doc).toEqual({ v: 1, preset: 'midnight' });
    expect(useThemeStore.getState().draft).toBeNull();
    expect(result.current.dirty).toBe(false);
    expect(result.current.status.text).toBe('Applied');
  });

  it('edits to my theme in use: its colours are saved, and the active copy follows', async () => {
    const { result } = await mounted();
    act(() => result.current.change('accentHover', EDITED_ACCENT_HOVER));
    await act(() => result.current.apply());

    expect(api.updateSavedTheme).toHaveBeenCalledWith(THEME_ID, {
      inputs: expect.objectContaining({ accentHover: EDITED_ACCENT_HOVER }),
    });
    // In use already: the server's `active` is adopted, no second switch.
    expect(api.setTheme).not.toHaveBeenCalled();
    expect(useThemeStore.getState().doc.custom?.accentHover).toEqual(EDITED_ACCENT_HOVER);
    expect(useThemeStore.getState().draft).toBeNull();
  });

  it('edits to another of mine: its colours are saved first, then it is put in use', async () => {
    api.listThemes.mockResolvedValue(list({ mine: [mine(), mine({ id: OTHER_ID, name: 'Other' })] }));
    const order: string[] = [];
    api.updateSavedTheme.mockImplementationOnce(async (id: string, patch: Partial<SavedTheme>) => {
      order.push('save');
      return { theme: mine({ id, name: 'Other', ...patch }) };
    });
    api.setTheme.mockImplementationOnce(async () => {
      order.push('switch');
      return { ...ACTIVE_MINE, themeId: OTHER_ID, name: 'Other' };
    });
    const { result } = await mounted();
    act(() => result.current.use(OTHER_ID));
    act(() => result.current.change('accentHover', EDITED_ACCENT_HOVER));
    await act(() => result.current.apply());

    expect(order).toEqual(['save', 'switch']);
    expect(api.setTheme).toHaveBeenCalledWith({ themeId: OTHER_ID });
    expect(useThemeStore.getState().doc.themeId).toBe(OTHER_ID);
  });

  it('edits to a preset make "My <preset>" on Apply, not before', async () => {
    useThemeStore.setState({ doc: { v: 1, preset: 'midnight' } });
    api.listThemes.mockResolvedValue(list({ mine: [] }));
    const { result } = await mounted();
    act(() => result.current.change('accentHover', EDITED_ACCENT_HOVER));
    await settle(700);
    expect(api.createTheme).not.toHaveBeenCalled();

    await act(() => result.current.apply());
    expect(api.createTheme).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Midnight', base: 'midnight' }));
    expect(api.setTheme).toHaveBeenCalledWith({ themeId: NEW_ID });
    expect(result.current.status.text).toBe('Applied. Saved as My Midnight.');
    expect(result.current.selection).toMatchObject({ kind: 'mine', key: NEW_ID });
    expect(result.current.dirty).toBe(false);
  });

  it('a refused apply keeps the draft and says why', async () => {
    api.setTheme.mockRejectedValueOnce(new Error('offline'));
    const { result } = await mounted();
    act(() => result.current.pickPreset('nebula'));
    await act(() => result.current.apply());

    expect(result.current.status).toEqual({ tone: 'error', text: 'Not applied: check your connection and try again.' });
    expect(useThemeStore.getState().doc).toEqual(ACTIVE_MINE);
    expect(result.current.selection.key).toBe('preset:nebula');
    expect(result.current.canApply).toBe(true);
  });
});

describe('F1: Back to current', () => {
  it('drops the draft: the preview shows the active theme again, nothing sent', async () => {
    const { result } = await mounted();
    act(() => result.current.pickPreset('mono'));
    act(() => result.current.change('accent', [0.9, 0.05, 90]));
    expect(result.current.dirty).toBe(true);

    act(() => result.current.discard());
    expect(result.current.dirty).toBe(false);
    expect(result.current.selection).toMatchObject({ kind: 'mine', key: THEME_ID });
    expect(result.current.inputs).toEqual(EMBER_INPUTS);
    expect(useThemeStore.getState().draft).toBeNull();
    noServerCalls();
  });
});

describe('F1: unreadable colours block Apply', () => {
  it('apply does nothing while a pair fails; Fix it works in the draft and unblocks it', async () => {
    const { result } = await mounted();
    act(() => result.current.change('accent', MURKY_ACCENT));

    const fail = result.current.findings.find((f) => f.level === 'fail');
    expect(fail).toBeDefined();
    expect(result.current.canApply).toBe(false);
    expect(result.current.status).toEqual({ tone: 'blocked', text: 'Not saved: accent links on the background is hard to read.' });
    await act(() => result.current.apply());
    noServerCalls();

    act(() => result.current.fix(result.current.findings.find((f) => f.level === 'fail' && f.fix)!));
    expect(result.current.findings.some((f) => f.level === 'fail')).toBe(false);
    // Fixed in the draft only: still nothing saved until Apply.
    noServerCalls();
    expect(result.current.canApply).toBe(true);
  });
});

describe('N1 (changed by F1): leaving applies nothing and keeps the draft', () => {
  it('unmount sends nothing; coming back shows the same draft with Apply', async () => {
    const { result, unmount } = await mounted();
    act(() => result.current.change('accentHover', EDITED_ACCENT_HOVER));

    unmount();
    await settle(700);
    noServerCalls();
    expect(useThemeStore.getState().doc).toEqual(ACTIVE_MINE);

    const back = await mounted();
    expect(back.result.current.inputs.accentHover).toEqual(EDITED_ACCENT_HOVER);
    expect(back.result.current.dirty).toBe(true);
    expect(back.result.current.canApply).toBe(true);
  });

  it('pagehide (closing the tab, backgrounding) sends nothing either', async () => {
    const { result } = await mounted();
    act(() => result.current.pickPreset('forest'));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await settle();
    noServerCalls();
  });
});

describe('N2: applies run one after another', () => {
  it('a switch applied right after a colour save waits for that save to land', async () => {
    api.listThemes.mockResolvedValue(list({ mine: [mine(), mine({ id: OTHER_ID, name: 'Other theme' })] }));
    const order: string[] = [];
    api.updateSavedTheme.mockImplementation(async (id: string, patch: Partial<SavedTheme>) => {
      order.push('save:start');
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('save:done');
      const theme = mine({ id, ...patch });
      return { theme, active: docFromSaved(theme) };
    });
    api.setTheme.mockImplementation(async () => {
      order.push('switch');
      return { ...ACTIVE_MINE, themeId: OTHER_ID, name: 'Other theme' };
    });

    const { result } = await mounted();
    act(() => result.current.change('accentHover', EDITED_ACCENT_HOVER));
    let first!: Promise<void>;
    act(() => {
      first = result.current.apply();
    });
    act(() => result.current.use(OTHER_ID));
    let second!: Promise<void>;
    act(() => {
      second = result.current.apply();
    });
    await act(() => Promise.all([first, second]));

    expect(order).toEqual(['save:start', 'save:done', 'switch']);
    expect(useThemeStore.getState().doc.themeId).toBe(OTHER_ID);
  });
});

describe('V10: deleting the theme in use', () => {
  it('selects the preset the server falls back to', async () => {
    api.deleteSavedTheme.mockResolvedValue({ ok: true, active: { v: 1, preset: 'midnight' } });
    const { result } = await mounted();
    expect(result.current.selection.kind).toBe('mine');

    await act(() => result.current.remove(THEME_ID));

    expect(result.current.selection).toMatchObject({ kind: 'preset', key: 'preset:midnight' });
    expect(result.current.list?.mine).toEqual([]);
    expect(useThemeStore.getState().doc).toEqual({ v: 1, preset: 'midnight' });
  });

  it('a draft of the deleted theme goes with it', async () => {
    api.listThemes.mockResolvedValue(list({ mine: [mine(), mine({ id: OTHER_ID, name: 'Other' })] }));
    api.deleteSavedTheme.mockResolvedValue({ ok: true });
    const { result } = await mounted();
    act(() => result.current.use(OTHER_ID));
    expect(result.current.dirty).toBe(true);

    await act(() => result.current.remove(OTHER_ID));
    expect(useThemeStore.getState().draft).toBeNull();
    expect(result.current.selection).toMatchObject({ kind: 'mine', key: THEME_ID });
  });
});
