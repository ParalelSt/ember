import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useThemeStore } from '@/stores/useThemeStore';
import { DEFAULT_THEME, type ThemeDoc, type ThemeInputs } from '@/lib/theme/model';
import { formatOklch, oklchToHex } from '@/lib/theme/oklch';
import { PRESET_BY_ID } from '@/lib/theme/presets';
import { docFromSaved, type SavedTheme, type SharedTheme, type ThemeSelection } from '@/lib/theme/saved';

vi.mock('next/link', () => ({ default: ({ children, ...rest }: ComponentProps<'a'>) => <a {...rest}>{children}</a> }));

// A small in-memory /api/themes + /api/theme, so the page runs its real
// flows (the draft in the preview, Apply's optimistic select, adopt)
// against something that answers like the routes do.
const server = vi.hoisted(() => ({
  mine: [] as SavedTheme[],
  shared: [] as SharedTheme[],
  active: null as ThemeDoc | null,
  nextId: 0,
  failCreate: null as null | { status: number; body: unknown },
}));

function apiError(status: number, body: { error: string; findings?: unknown }) {
  return Object.assign(new Error(body.error), { status, body });
}

vi.mock('@/lib/api', () => {
  const id = () => `t${String(++server.nextId).padStart(14, '0')}`;
  const row = (over: Partial<SavedTheme> & Pick<SavedTheme, 'name' | 'base' | 'inputs'>): SavedTheme => ({
    id: id(),
    shared: false,
    created: '2026-09-23',
    updated: '2026-09-23',
    ...over,
  });
  return {
    api: {
      getTheme: vi.fn(async () => server.active ?? { v: 1, preset: 'ember' }),
      setTheme: vi.fn(async (sel: ThemeSelection) => {
        if ('preset' in sel) server.active = { v: 1, preset: sel.preset };
        else {
          const t = server.mine.find((x) => x.id === sel.themeId) ?? server.shared.find((x) => x.id === sel.themeId);
          if (!t) throw apiError(404, { error: 'No such theme' });
          server.active = docFromSaved(t);
        }
        return server.active;
      }),
      listThemes: vi.fn(async () => ({ mine: [...server.mine], shared: [...server.shared], cap: 20 })),
      createTheme: vi.fn(async (body: { name: string; base: SavedTheme['base']; inputs: ThemeInputs }) => {
        if (server.failCreate) throw apiError(server.failCreate.status, server.failCreate.body as { error: string });
        if (server.mine.length >= 20) throw apiError(409, { error: 'You can keep up to 20 themes. Delete one to make room.' });
        const t = row(body);
        server.mine = [t, ...server.mine];
        return { theme: t };
      }),
      duplicateTheme: vi.fn(async (source: string) => {
        const from = server.mine.find((x) => x.id === source) ?? server.shared.find((x) => x.id === source)!;
        if (server.mine.length >= 20) throw apiError(409, { error: 'You can keep up to 20 themes. Delete one to make room.' });
        const t = row({ name: `${from.name} copy`, base: from.base, inputs: from.inputs });
        server.mine = [t, ...server.mine];
        return { theme: t };
      }),
      updateSavedTheme: vi.fn(async (tid: string, patch: Partial<SavedTheme>) => {
        const t = { ...server.mine.find((x) => x.id === tid)!, ...patch };
        server.mine = server.mine.map((x) => (x.id === tid ? t : x));
        const active = server.active?.themeId === tid ? (server.active = docFromSaved(t)) : undefined;
        return { theme: t, ...(active ? { active } : {}) };
      }),
      deleteSavedTheme: vi.fn(async (tid: string) => {
        server.mine = server.mine.filter((x) => x.id !== tid);
        if (server.active?.themeId === tid) {
          const kept = { ...server.active };
          delete kept.themeId;
          server.active = kept;
          return { ok: true, active: kept };
        }
        return { ok: true };
      }),
    },
  };
});

const { api } = await import('@/lib/api');
const { default: SettingsAppearance } = await import('./page');

const MIDNIGHT = PRESET_BY_ID.midnight.inputs;
const NIGHT_DRIVE: ThemeInputs = { ...MIDNIGHT, accent: [0.72, 0.16, 300], accentHover: [0.8, 0.12, 300] };

function saved(over: Partial<SavedTheme> = {}): SavedTheme {
  return {
    id: 'mine00000000001',
    name: 'Night drive',
    base: 'midnight',
    inputs: NIGHT_DRIVE,
    shared: false,
    created: '2026-09-23',
    updated: '2026-09-23',
    ...over,
  };
}

const LUKA: SharedTheme = {
  id: 'luka00000000001',
  name: 'Cold brew',
  base: 'nebula',
  inputs: PRESET_BY_ID.nebula.inputs,
  ownerName: 'Luka',
  updated: '2026-09-23',
};

function start(doc: ThemeDoc = DEFAULT_THEME) {
  server.active = doc;
  useThemeStore.setState({ doc, draft: null, userId: 'u1', loaded: true });
  return render(<SettingsAppearance />);
}

const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
const hexField = (label: string) => screen.getByLabelText(`${label} hex`) as HTMLInputElement;
function typeHex(label: string, hex: string) {
  const field = hexField(label);
  fireEvent.change(field, { target: { value: hex } });
  fireEvent.blur(field);
}
const status = () => screen.getByTestId('save-status');
const applyButton = () => screen.getByRole('button', { name: 'Apply' });
const apply = () => fireEvent.click(applyButton());
const previewVar = (name: string) => screen.getByTestId('theme-preview').style.getPropertyValue(name);
const SLOW = { timeout: 3000 };

beforeEach(() => {
  server.mine = [];
  server.shared = [];
  server.active = null;
  server.nextId = 0;
  server.failCreate = null;
  vi.clearAllMocks();
});

afterEach(() => {
  useThemeStore.setState({ doc: DEFAULT_THEME, draft: null, userId: null });
});

describe('Settings > Appearance', () => {
  it('shows the preview and three tabs, Themes first', async () => {
    start();
    expect(screen.getByTestId('theme-preview')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Themes', 'Colours', 'Share']);
    expect(screen.getByRole('radiogroup', { name: 'Presets' })).toBeInTheDocument();
    expect(await screen.findByTestId('theme-count')).toHaveTextContent('0 of 20');

    tab('Colours');
    expect(screen.getAllByTestId('colour-row')).toHaveLength(8);
    tab('Share');
    expect(screen.getByRole('switch', { name: 'Share with everyone' })).toBeInTheDocument();
  });

  it('picking a preset shows it in the preview only; Apply applies and saves it', async () => {
    start();
    await screen.findByTestId('theme-count');
    expect(screen.queryByTestId('apply-bar')).toBeNull();
    expect(screen.getByTestId('in-use-bar')).toHaveTextContent('In use: Ember.');

    fireEvent.click(screen.getByRole('radio', { name: /Midnight/ }));
    // The preview carries the chosen colours on its own wrapper...
    expect(previewVar('--ember')).toBe(formatOklch(MIDNIGHT.accent));
    expect(screen.getByRole('radio', { name: /Midnight/ })).toHaveAttribute('aria-checked', 'true');
    // ...and nothing else moved: the active theme, the account, the "In use" tag.
    expect(useThemeStore.getState().doc).toEqual(DEFAULT_THEME);
    expect(api.setTheme).not.toHaveBeenCalled();
    expect(within(screen.getByRole('radio', { name: /Ember/ })).getByTestId('in-use')).toBeInTheDocument();
    expect(screen.getByTestId('apply-bar')).toHaveTextContent('Midnight shows in the preview only.');
    expect(screen.getByRole('button', { name: 'Back to current' })).toBeInTheDocument();

    apply();
    await waitFor(() => expect(useThemeStore.getState().doc).toEqual({ v: 1, preset: 'midnight' }));
    expect(api.setTheme).toHaveBeenCalledWith({ preset: 'midnight' });
    await waitFor(() => expect(status()).toHaveTextContent('Applied'));
    expect(screen.queryByTestId('apply-bar')).toBeNull();
    expect(screen.getByTestId('in-use-bar')).toHaveTextContent('In use: Midnight.');
    expect(within(screen.getByRole('radio', { name: /Midnight/ })).getByTestId('in-use')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Ember/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('Back to current puts the preview back on the theme in use', async () => {
    start({ v: 1, preset: 'forest' });
    await screen.findByTestId('theme-count');
    fireEvent.click(screen.getByRole('radio', { name: /Mono/ }));
    tab('Colours');
    typeHex('Accent', '#3aa0ff');
    expect(screen.getByTestId('apply-bar')).toHaveTextContent('Your changes to Mono show in the preview only.');

    fireEvent.click(screen.getByRole('button', { name: 'Back to current' }));
    expect(screen.queryByTestId('apply-bar')).toBeNull();
    expect(previewVar('--ember')).toBe(formatOklch(PRESET_BY_ID.forest.inputs.accent));
    expect(hexField('Accent').value).toBe(oklchToHex(PRESET_BY_ID.forest.inputs.accent));
    expect(api.setTheme).not.toHaveBeenCalled();
    expect(api.createTheme).not.toHaveBeenCalled();
  });

  describe('My themes', () => {
    it('New saves a copy of what is showing, shows it in the preview and opens Colours', async () => {
      start({ v: 1, preset: 'forest' });
      await screen.findByTestId('theme-count');
      fireEvent.click(screen.getByRole('button', { name: /New/ }));
      await waitFor(() => expect(screen.getByRole('tab', { name: 'Colours' })).toHaveAttribute('aria-selected', 'true'));
      expect(api.createTheme).toHaveBeenCalledWith({ name: 'New theme', base: 'forest', inputs: PRESET_BY_ID.forest.inputs });
      const made = server.mine[0]!;
      // Saved to the list, not put in use: that is Apply's job.
      expect(useThemeStore.getState().doc).toEqual({ v: 1, preset: 'forest' });
      expect(api.setTheme).not.toHaveBeenCalled();
      tab('Themes');
      expect(screen.getByTestId('theme-count')).toHaveTextContent('1 of 20');
      expect(screen.getByRole('button', { name: 'Preview New theme' })).toHaveAttribute('aria-pressed', 'true');
      apply();
      await waitFor(() => expect(useThemeStore.getState().doc.themeId).toBe(made.id));
    });

    it('rename, duplicate and delete', async () => {
      server.mine = [saved()];
      start({ v: 1, preset: 'ember' });
      await screen.findByText('Night drive');

      fireEvent.click(screen.getByRole('button', { name: 'Rename Night drive' }));
      const field = screen.getByLabelText('New name for Night drive');
      fireEvent.change(field, { target: { value: '   ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('A name is 1 to 40 characters.')).toBeInTheDocument();
      fireEvent.change(field, { target: { value: 'Late drive' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByText('Late drive');
      expect(api.updateSavedTheme).toHaveBeenCalledWith('mine00000000001', { name: 'Late drive' });

      fireEvent.click(screen.getByRole('button', { name: 'Duplicate Late drive' }));
      await screen.findByText('Late drive copy');
      expect(screen.getByTestId('theme-count')).toHaveTextContent('2 of 20');

      fireEvent.click(screen.getByRole('button', { name: 'Delete Late drive copy' }));
      expect(screen.getByText('Delete Late drive copy?')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
      expect(screen.getByText('Late drive copy')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Delete Late drive copy' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(screen.queryByText('Late drive copy')).toBeNull());
      expect(screen.getByTestId('theme-count')).toHaveTextContent('1 of 20');
    });

    it('deleting the theme in use keeps its colours, as a kept copy', async () => {
      const t = saved();
      server.mine = [t];
      start(docFromSaved(t));
      await screen.findByText('Night drive');
      fireEvent.click(screen.getByRole('button', { name: 'Delete Night drive' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await screen.findByTestId('loose-theme');
      const doc = useThemeStore.getState().doc;
      expect(doc.themeId).toBeUndefined();
      expect(doc.custom).toEqual(NIGHT_DRIVE);
    });

    it('at the cap: New is off and the page says why; a refused save says so too', async () => {
      server.mine = Array.from({ length: 20 }, (_, i) => saved({ id: `mine${String(i).padStart(11, '0')}`, name: `T${i}` }));
      start();
      expect(await screen.findByTestId('theme-count')).toHaveTextContent('20 of 20');
      expect(screen.getByRole('button', { name: /New/ })).toBeDisabled();
      expect(screen.getByText(/That is the most you can keep \(20\)/)).toBeInTheDocument();

      // Applying an edited preset would make a 21st theme: refused, in plain words.
      tab('Colours');
      typeHex('Accent', '#3aa0ff');
      apply();
      await waitFor(() => expect(status()).toHaveTextContent('Not applied: You can keep up to 20 themes. Delete one to make room.'), SLOW);
      expect(screen.getByTestId('apply-bar')).toBeInTheDocument();
    });
  });

  describe('Shared by others', () => {
    it('lists them by name, Preview shows one, Apply puts it in use, Copy makes one of mine', async () => {
      server.shared = [LUKA];
      start();
      const row = (await screen.findByText('Cold brew')).closest('[data-testid="shared-theme"]') as HTMLElement;
      expect(within(row).getByText('by Luka')).toBeInTheDocument();

      fireEvent.click(within(row).getByRole('button', { name: 'Preview Cold brew' }));
      expect(within(row).getByRole('button', { name: 'Preview Cold brew' })).toHaveTextContent('Showing');
      expect(previewVar('--background')).toBe(formatOklch(LUKA.inputs.background));
      expect(api.setTheme).not.toHaveBeenCalled();
      expect(useThemeStore.getState().doc).toEqual(DEFAULT_THEME);

      apply();
      await waitFor(() => expect(api.setTheme).toHaveBeenCalledWith({ themeId: LUKA.id }));
      expect(useThemeStore.getState().doc.themeId).toBe(LUKA.id);
      await waitFor(() => expect(within(row).getByTestId('in-use')).toBeInTheDocument());

      // Read-only on Colours, with the way to a copy.
      tab('Colours');
      expect(screen.getByTestId('read-only-note')).toHaveTextContent('Shared by Luka. Only Luka can change it.');
      expect(hexField('Background')).toHaveAttribute('readonly');
      tab('Themes');

      fireEvent.click(screen.getByRole('button', { name: 'Copy Cold brew to my themes' }));
      expect(await screen.findByText('Copied to My themes as Cold brew copy.')).toBeInTheDocument();
      expect(api.duplicateTheme).toHaveBeenCalledWith(LUKA.id);
      expect(screen.getByTestId('theme-count')).toHaveTextContent('1 of 20');
    });
  });

  describe('Share', () => {
    it('turns sharing on and off for one of mine, with who sees it', async () => {
      const t = saved();
      server.mine = [t];
      start(docFromSaved(t));
      await screen.findByText('Night drive');
      tab('Share');
      const toggle = screen.getByRole('switch', { name: 'Share with everyone' });
      expect(toggle).toBeEnabled();
      expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByTestId('share-line')).toHaveTextContent('Only you see Night drive.');

      fireEvent.click(toggle);
      await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
      expect(api.updateSavedTheme).toHaveBeenCalledWith(t.id, { shared: true });
      expect(screen.getByTestId('share-line')).toHaveTextContent('Everyone on this Ember server sees Night drive');

      fireEvent.click(toggle);
      await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
      expect(api.updateSavedTheme).toHaveBeenLastCalledWith(t.id, { shared: false });
    });

    it('is off for a preset and for someone else\'s theme', async () => {
      server.shared = [LUKA];
      const { unmount } = start({ v: 1, preset: 'mono' });
      await screen.findByText('Cold brew');
      tab('Share');
      expect(screen.getByRole('switch', { name: 'Share with everyone' })).toBeDisabled();
      expect(screen.getByTestId('share-line')).toHaveTextContent('Mono is a preset');
      unmount();

      start(docFromSaved(LUKA));
      await screen.findByText('Cold brew');
      tab('Share');
      expect(screen.getByRole('switch', { name: 'Share with everyone' })).toBeDisabled();
      expect(screen.getByTestId('share-line')).toHaveTextContent('Cold brew is shared by Luka. Only Luka can change who sees it.');
    });
  });

  describe('Colours', () => {
    it('a Basic re-fills the auto rows, a More row pins, Reset unpins; the preview follows, Apply saves', async () => {
      const t = saved();
      server.mine = [t];
      start(docFromSaved(t));
      await screen.findByText('Night drive');
      tab('Colours');

      const surfaceBefore = hexField('Surface').value;
      typeHex('Background', '#303848');
      // Live at once in the page's preview; the app and the account wait for Apply.
      expect(hexField('Surface').value).not.toBe(surfaceBefore);
      expect(oklchToHex(useThemeStore.getState().draft!.edit!.inputs.background)).toBe('#303848');
      expect(useThemeStore.getState().doc).toEqual(docFromSaved(t));
      await new Promise((r) => setTimeout(r, 900));
      expect(api.updateSavedTheme).not.toHaveBeenCalled();

      apply();
      await waitFor(() => expect(api.updateSavedTheme).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(status()).toHaveTextContent('Applied'));
      const sent = vi.mocked(api.updateSavedTheme).mock.calls[0]![1].inputs!;
      expect(oklchToHex(sent.background)).toBe('#303848');
      expect(useThemeStore.getState().doc.custom?.background).toEqual(sent.background);
      expect(screen.queryByTestId('apply-bar')).toBeNull();

      // Pin Surface by hand; a Background change leaves it alone.
      const pill = () => screen.getByRole('button', { name: /Surface/ });
      expect(pill()).toHaveTextContent('Auto');
      typeHex('Surface', '#404040');
      expect(pill()).toHaveTextContent('Reset');
      typeHex('Background', '#202428');
      expect(hexField('Surface').value).toBe('#404040');

      // Reset puts it back on the rules.
      fireEvent.click(pill());
      expect(pill()).toHaveTextContent('Auto');
      expect(hexField('Surface').value).not.toBe('#404040');
    });

    it('a preset edit is saved as a new theme of mine on Apply, not before', async () => {
      start({ v: 1, preset: 'midnight' });
      await screen.findByTestId('theme-count');
      tab('Colours');
      expect(screen.getByText('Change a colour and apply it, and it is saved as a new theme in My themes.')).toBeInTheDocument();
      typeHex('Accent', '#3aa0ff');
      await new Promise((r) => setTimeout(r, 900));
      expect(api.createTheme).not.toHaveBeenCalled();
      expect(server.mine).toHaveLength(0);
      apply();
      await waitFor(() => expect(status()).toHaveTextContent('Applied. Saved as My Midnight.'), SLOW);
      expect(api.createTheme).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Midnight', base: 'midnight' }));
      const made = server.mine[0]!;
      expect(useThemeStore.getState().doc.themeId).toBe(made.id);
      expect(hexField('Accent').value).toBe('#3aa0ff');
    });

    it('an unreadable pair shows with Fix it and blocks Apply until fixed', async () => {
      const t = saved();
      server.mine = [t];
      start(docFromSaved(t));
      await screen.findByText('Night drive');
      tab('Colours');

      typeHex('Accent', '#141c2c');
      const finding = screen
        .getAllByTestId('finding')
        .find((f) => f.textContent?.startsWith('Accent links on the background'))!;
      expect(finding).toHaveAttribute('data-level', 'fail');
      expect(finding).toHaveTextContent('hard to read');
      expect(status()).toHaveTextContent('Not saved: accent links on the background is hard to read.');
      // Shown in the preview, never saved, never adjusted, and Apply is off.
      expect(previewVar('--ember')).not.toBe(formatOklch(NIGHT_DRIVE.accent));
      expect(applyButton()).toBeDisabled();
      apply();
      await new Promise((r) => setTimeout(r, 300));
      expect(api.updateSavedTheme).not.toHaveBeenCalled();
      expect(hexField('Accent').value).toBe('#141c2c');

      // Fix it moves the draft, still unsaved; then Apply is on.
      fireEvent.click(within(finding).getByRole('button', { name: 'Fix it' }));
      expect(screen.queryAllByTestId('finding').filter((f) => f.getAttribute('data-level') === 'fail')).toHaveLength(0);
      expect(api.updateSavedTheme).not.toHaveBeenCalled();
      expect(applyButton()).toBeEnabled();
      apply();
      await waitFor(() => expect(api.updateSavedTheme).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(status()).toHaveTextContent('Applied'));
    });

    it('Reset to the base preset asks first, then Apply saves the preset\'s colours', async () => {
      const t = saved();
      server.mine = [t];
      start(docFromSaved(t));
      await screen.findByText('Night drive');
      tab('Colours');
      fireEvent.click(screen.getByRole('button', { name: 'Reset to Midnight' }));
      expect(screen.getByTestId('reset-confirm')).toHaveTextContent('Reset every colour to Midnight?');
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
      expect(api.updateSavedTheme).not.toHaveBeenCalled();
      apply();
      await waitFor(() => expect(api.updateSavedTheme).toHaveBeenCalledWith(t.id, { inputs: MIDNIGHT }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Reset to Midnight' })).toBeDisabled());
    });

    it('an invalid hex is refused in plain words and changes nothing', async () => {
      start({ v: 1, preset: 'ember' });
      await screen.findByTestId('theme-count');
      tab('Colours');
      const before = hexField('Text').value;
      typeHex('Text', 'purple');
      expect(screen.getByText('Use a colour like #1a2b3c.')).toBeInTheDocument();
      expect(hexField('Text').value).toBe(before);
    });
  });

  it('leaving the page applies nothing and keeps the draft for when you come back', async () => {
    const t = saved();
    server.mine = [t];
    const { unmount } = start(docFromSaved(t));
    await screen.findByText('Night drive');
    tab('Colours');
    typeHex('Accent', '#3aa0ff');
    act(() => unmount());
    await new Promise((r) => setTimeout(r, 900));
    expect(api.updateSavedTheme).not.toHaveBeenCalled();
    expect(api.setTheme).not.toHaveBeenCalled();
    expect(useThemeStore.getState().doc).toEqual(docFromSaved(t));

    render(<SettingsAppearance />);
    expect(await screen.findByTestId('apply-bar')).toHaveTextContent('Your changes to Night drive show in the preview only.');
    tab('Colours');
    expect(hexField('Accent').value).toBe('#3aa0ff');
    apply();
    await waitFor(() => expect(api.updateSavedTheme).toHaveBeenCalledTimes(1));
  });
});
