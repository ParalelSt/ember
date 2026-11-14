import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { formatOklch } from '@/lib/theme/oklch';
import { PRESETS } from '@/lib/theme/presets';
import type { SavedTheme, SharedTheme } from '@/lib/theme/saved';
import { ThemeLibrary } from './ThemeLibrary';

const INPUTS = PRESETS[1].inputs;
const MINE = { id: 'mine1', name: 'Night drive', inputs: INPUTS, shared: false } as SavedTheme;
const THEIRS = { id: 'their1', name: 'Cold brew', inputs: PRESETS[2].inputs, ownerName: 'Luka' } as SharedTheme;

function library(over: Partial<ComponentProps<typeof ThemeLibrary>> = {}) {
  const props = {
    view: 'presets',
    shownPreset: 'ember',
    shownThemeId: null,
    inUsePreset: 'ember',
    inUseThemeId: null,
    mine: [MINE],
    shared: [THEIRS],
    cap: 20,
    onPickPreset: vi.fn(),
    onUse: vi.fn(),
    onNew: vi.fn(),
    onRename: vi.fn().mockResolvedValue(null),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onCopyShared: vi.fn(),
    onShare: vi.fn(),
    ...over,
  } satisfies ComponentProps<typeof ThemeLibrary>;
  render(<ThemeLibrary {...props} />);
  return props;
}

const radio = (name: RegExp) => screen.getByRole('radio', { name });

describe('ThemeLibrary, preview cards', () => {
  it('presets are a radiogroup laid out in two columns, one card each', () => {
    library();
    const group = screen.getByRole('radiogroup', { name: 'Presets' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(PRESETS.length);
    expect(radios[0].parentElement).toHaveClass('grid', 'grid-cols-2');
  });

  it('a card previews the real colours: its background, with accent and surface dots', () => {
    library();
    PRESETS.forEach((p) => {
      const swatch = within(radio(new RegExp(p.name))).getByTestId('theme-swatch');
      expect(swatch.style.getPropertyValue('--swatch-bg')).toBe(formatOklch(p.inputs.background));
      expect(swatch.style.getPropertyValue('--swatch-accent')).toBe(formatOklch(p.inputs.accent));
      expect(swatch.style.getPropertyValue('--swatch-surface')).toBe(formatOklch(p.inputs.surface));
      expect(swatch).toHaveClass('bg-(--swatch-bg)');
      expect(swatch.querySelector('[data-swatch-dot="accent"]')).toHaveClass('bg-(--swatch-accent)');
      expect(swatch.querySelector('[data-swatch-dot="surface"]')).toHaveClass('bg-(--swatch-surface)');
    });
  });

  it('the selected card is ember, with a tick, and is the only one checked', () => {
    library({ shownPreset: 'midnight', inUsePreset: 'ember' });
    const on = radio(/Midnight/);
    const off = radio(/^Ember/);
    expect(on).toHaveAttribute('aria-checked', 'true');
    expect(on).toHaveClass('border-ember', 'bg-ember/10');
    expect(within(on).getByTestId('theme-selected')).toBeInTheDocument();
    expect(off).toHaveAttribute('aria-checked', 'false');
    expect(off).not.toHaveClass('border-ember');
    expect(within(off).queryByTestId('theme-selected')).toBeNull();
    // Selected and in use are different things.
    expect(within(off).getByTestId('in-use')).toBeInTheDocument();
    expect(within(on).queryByTestId('in-use')).toBeNull();
  });

  it('a card keeps the description, clamped and as its title, and a real button for the keyboard', () => {
    library();
    const p = PRESETS[0];
    const card = radio(/^Ember/);
    expect(card.tagName).toBe('BUTTON');
    expect(card).toHaveAttribute('title', p.description);
    expect(within(card).getByText(p.description)).toHaveClass('line-clamp-2');
    expect(card.className).toContain('focus-visible:ring-3');
  });

  it('a tap picks the preset', () => {
    const p = library();
    fireEvent.click(radio(/Midnight/));
    expect(p.onPickPreset).toHaveBeenCalledWith('midnight');
  });

  it('a long name truncates inside its column instead of widening it', () => {
    const name = 'A very long theme name that will not fit';
    library({ view: 'mine', mine: [{ ...MINE, name }] });
    expect(screen.getByText(name)).toHaveClass('truncate');
    expect(screen.getByText(name).closest('[data-testid="my-theme"]')).toHaveClass('min-w-0');
  });
});

describe('ThemeLibrary, my themes as cards', () => {
  const card = () => screen.getByTestId('my-theme');

  it('sit in the same grid and keep Preview, share, rename, duplicate and delete', () => {
    const p = library({ view: 'mine' });
    expect(card().parentElement).toHaveClass('grid', 'grid-cols-2');
    fireEvent.click(within(card()).getByRole('button', { name: 'Preview Night drive' }));
    expect(p.onUse).toHaveBeenCalledWith('mine1');
    fireEvent.click(within(card()).getByRole('switch', { name: 'Share Night drive with everyone' }));
    expect(p.onShare).toHaveBeenCalledWith('mine1', true);
    fireEvent.click(within(card()).getByRole('button', { name: 'Duplicate Night drive' }));
    expect(p.onDuplicate).toHaveBeenCalledWith('mine1');
  });

  it('the one the preview shows is ember and pressed', () => {
    library({ view: 'mine', shownPreset: null, shownThemeId: 'mine1' });
    expect(card()).toHaveClass('border-ember', 'bg-ember/10');
    expect(within(card()).getByRole('button', { name: 'Preview Night drive' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(card()).getByTestId('theme-selected')).toBeInTheDocument();
  });

  it('renaming takes the whole row, saves, and comes back', async () => {
    const p = library({ view: 'mine' });
    fireEvent.click(within(card()).getByRole('button', { name: 'Rename Night drive' }));
    expect(card()).toHaveClass('col-span-2');
    fireEvent.change(screen.getByRole('textbox', { name: 'New name for Night drive' }), { target: { value: 'Late' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(p.onRename).toHaveBeenCalledWith('mine1', 'Late'));
    await waitFor(() => expect(card()).not.toHaveClass('col-span-2'));
  });

  it('a rename that fails says why and stays open', async () => {
    library({ view: 'mine', onRename: vi.fn().mockResolvedValue('That name is taken') });
    fireEvent.click(within(card()).getByRole('button', { name: 'Rename Night drive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('That name is taken')).toBeInTheDocument();
    expect(card()).toHaveClass('col-span-2');
  });

  it('deleting asks first, on the whole row; Keep backs out', () => {
    const p = library({ view: 'mine' });
    fireEvent.click(within(card()).getByRole('button', { name: 'Delete Night drive' }));
    expect(card()).toHaveClass('col-span-2');
    expect(card()).toHaveTextContent('Delete Night drive?');
    fireEvent.click(within(card()).getByRole('button', { name: 'Keep' }));
    expect(p.onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(card()).getByRole('button', { name: 'Delete Night drive' }));
    fireEvent.click(within(card()).getByRole('button', { name: 'Delete' }));
    expect(p.onDelete).toHaveBeenCalledWith('mine1');
  });

  it('at the cap Duplicate is off', () => {
    library({ view: 'mine', cap: 1 });
    expect(within(card()).getByRole('button', { name: 'Duplicate Night drive' })).toBeDisabled();
  });

  it('on a phone the switch has its own line, so the hit boxes never leave the column', () => {
    library({ view: 'mine' });
    const sw = within(card()).getByRole('switch');
    const rename = within(card()).getByRole('button', { name: 'Rename Night drive' });
    expect(sw.parentElement).not.toBe(rename.parentElement);
    expect(sw.parentElement).toHaveClass('w-full', 'md:w-auto');
    expect(rename.parentElement).toHaveClass('w-full', 'md:w-auto');
  });
});

describe('ThemeLibrary, other people’s themes as cards', () => {
  it('sit in the grid and keep Copy and Preview', () => {
    const p = library({ view: 'shared' });
    const card = screen.getByTestId('shared-theme');
    expect(card.parentElement).toHaveClass('grid', 'grid-cols-2');
    expect(card).toHaveTextContent('by Luka');
    fireEvent.click(within(card).getByRole('button', { name: 'Copy Cold brew to my themes' }));
    expect(p.onCopyShared).toHaveBeenCalledWith('their1');
    fireEvent.click(within(card).getByRole('button', { name: 'Preview Cold brew' }));
    expect(p.onUse).toHaveBeenCalledWith('their1');
  });

  it('the one showing is ember and its button says so', () => {
    library({ view: 'shared', shownPreset: null, shownThemeId: 'their1' });
    const card = screen.getByTestId('shared-theme');
    expect(card).toHaveClass('border-ember');
    expect(within(card).getByRole('button', { name: 'Preview Cold brew' })).toHaveTextContent('Showing');
  });
});

describe('ThemeLibrary, one list per tab', () => {
  it('each view shows only its own list', () => {
    library({ view: 'presets' });
    expect(screen.getByRole('radiogroup', { name: 'Presets' })).toBeInTheDocument();
    expect(screen.queryByTestId('my-theme')).toBeNull();
    expect(screen.queryByTestId('shared-theme')).toBeNull();
  });

  it('My themes: its count, the New theme button and its own cards only', () => {
    library({ view: 'mine' });
    expect(screen.getByTestId('theme-count')).toHaveTextContent('1 of 20');
    expect(screen.getAllByTestId('my-theme')).toHaveLength(1);
    expect(screen.queryByRole('radiogroup', { name: 'Presets' })).toBeNull();
    expect(screen.queryByTestId('shared-theme')).toBeNull();
  });

  it('Shared: other people\'s cards only, with a line on what they are', () => {
    library({ view: 'shared' });
    expect(screen.getAllByTestId('shared-theme')).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Shared by others' })).toHaveTextContent('Themes other people shared.');
    expect(screen.queryByTestId('my-theme')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Presets' })).toBeNull();
  });
});

describe('ThemeLibrary, the New theme button', () => {
  it('says New theme with no plus, an outline button like Settings\' others, in the My themes header', () => {
    const p = library({ view: 'mine' });
    const button = screen.getByRole('button', { name: 'New theme' });
    expect(button).toHaveTextContent(/^New theme$/);
    expect(button.querySelector('svg')).toBeNull();
    expect(button).toHaveAttribute('data-slot', 'button');
    expect(button.className).toContain('border-border');
    // In the header, beside the count.
    expect(button.parentElement).toContainElement(screen.getByTestId('theme-count'));
    fireEvent.click(button);
    expect(p.onNew).toHaveBeenCalled();
  });

  it('is off while the list loads and at the cap', () => {
    library({ view: 'mine', mine: null });
    expect(screen.getByRole('button', { name: 'New theme' })).toBeDisabled();
  });

  it('is off at the cap, and the tab says why', () => {
    library({ view: 'mine', cap: 1 });
    expect(screen.getByRole('button', { name: 'New theme' })).toBeDisabled();
    expect(screen.getByText('That is the most you can keep (1). Delete one to make room.')).toBeInTheDocument();
  });
});

describe('ThemeLibrary, nothing moves (layout-shift pass)', () => {
  it('every preset card keeps a tag corner on its swatch, empty or not, out of the flow, so In use never changes a card\'s height', () => {
    library({ inUsePreset: 'midnight' });
    const slots = screen.getAllByTestId('tag-slot');
    expect(slots).toHaveLength(PRESETS.length);
    for (const slot of slots) expect(slot).toHaveClass('absolute');
    expect(slots.filter((l) => l.childElementCount > 0)).toHaveLength(1);
    const midnight = within(radio(/Midnight/));
    expect(midnight.getByTestId('tag-slot')).toContainElement(midnight.getByTestId('in-use'));
    // Drawn over the swatch's corner, but read after the name.
    expect(radio(/Midnight/)).toHaveClass('relative');
    expect(radio(/Midnight/)).toHaveAccessibleName(/^Midnight/);
    expect(within(radio(/^Ember/)).getByTestId('tag-slot')).toBeEmptyDOMElement();
  });

  it('every description keeps two lines, and every row of presets is as tall as the tallest', () => {
    library();
    for (const p of PRESETS) expect(within(radio(new RegExp(p.name))).getByText(p.description)).toHaveClass('min-h-8', 'line-clamp-2');
    expect(screen.getByRole('radiogroup', { name: 'Presets' })).toHaveClass('auto-rows-fr');
  });

  it('my cards and other people\'s keep the tag corner too', () => {
    library({ view: 'mine', mine: [MINE, { ...MINE, id: 'mine2', name: 'Shared one', shared: true }], inUseThemeId: 'mine2' });
    const [plain, both] = screen.getAllByTestId('my-theme');
    expect(within(plain!).getByTestId('tag-slot')).toBeEmptyDOMElement();
    expect(within(both!).getByTestId('tag-slot')).toHaveClass('absolute');
    expect(within(both!).getByTestId('tag-slot')).toContainElement(within(both!).getByTestId('shared-tag'));
    expect(within(both!).getByTestId('tag-slot')).toContainElement(within(both!).getByTestId('in-use'));
    cleanup();
    library({ view: 'shared', inUseThemeId: 'their1' });
    expect(within(screen.getByTestId('shared-theme')).getByTestId('tag-slot')).toContainElement(screen.getByTestId('in-use'));
  });

  it('a list still loading shows stand-in cards in the same grid, not a line of text', () => {
    library({ view: 'mine', mine: null });
    const loading = screen.getByRole('status', { name: 'Loading your themes' });
    expect(loading).toHaveClass('grid', 'grid-cols-2');
    const stand = within(loading).getAllByTestId('theme-skeleton');
    expect(stand).toHaveLength(2);
    // Built like a card: the swatch's block and the name's line.
    expect(stand[0]!.querySelector('.h-14')).not.toBeNull();
    expect(stand[0]!.querySelector('.h-5')).not.toBeNull();
    expect(screen.queryByTestId('theme-count')).toBeNull();
  });

  it('shared themes loading show stand-in cards too; a failed load says so', () => {
    library({ view: 'shared', shared: null });
    expect(screen.getByRole('status', { name: 'Loading shared themes' })).toBeInTheDocument();
    cleanup();
    library({ view: 'shared', shared: null, loadFailed: true });
    expect(screen.getByText('Could not load shared themes.')).toBeInTheDocument();
    expect(screen.queryByTestId('theme-skeleton')).toBeNull();
  });
});
