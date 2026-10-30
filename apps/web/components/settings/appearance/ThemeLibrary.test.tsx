import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { formatOklch } from '@/lib/theme/oklch';
import { PRESETS } from '@/lib/theme/presets';
import type { SavedTheme, SharedTheme } from '@/lib/theme/saved';
import { ThemeLibrary } from './ThemeLibrary';

const INPUTS = PRESETS[1].inputs;
const MINE = { id: 'mine1', name: 'Night drive', inputs: INPUTS, shared: false } as SavedTheme;
const THEIRS = { id: 'their1', name: 'Cold brew', inputs: PRESETS[2].inputs, ownerName: 'Luka' } as SharedTheme;

function library(over: Partial<ComponentProps<typeof ThemeLibrary>> = {}) {
  const props = {
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
    library({ mine: [{ ...MINE, name }] });
    expect(screen.getByText(name)).toHaveClass('truncate');
    expect(screen.getByText(name).closest('[data-testid="my-theme"]')).toHaveClass('min-w-0');
  });
});

describe('ThemeLibrary, my themes as cards', () => {
  const card = () => screen.getByTestId('my-theme');

  it('sit in the same grid and keep Preview, share, rename, duplicate and delete', () => {
    const p = library();
    expect(card().parentElement).toHaveClass('grid', 'grid-cols-2');
    fireEvent.click(within(card()).getByRole('button', { name: 'Preview Night drive' }));
    expect(p.onUse).toHaveBeenCalledWith('mine1');
    fireEvent.click(within(card()).getByRole('switch', { name: 'Share Night drive with everyone' }));
    expect(p.onShare).toHaveBeenCalledWith('mine1', true);
    fireEvent.click(within(card()).getByRole('button', { name: 'Duplicate Night drive' }));
    expect(p.onDuplicate).toHaveBeenCalledWith('mine1');
  });

  it('the one the preview shows is ember and pressed', () => {
    library({ shownPreset: null, shownThemeId: 'mine1' });
    expect(card()).toHaveClass('border-ember', 'bg-ember/10');
    expect(within(card()).getByRole('button', { name: 'Preview Night drive' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(card()).getByTestId('theme-selected')).toBeInTheDocument();
  });

  it('renaming takes the whole row, saves, and comes back', async () => {
    const p = library();
    fireEvent.click(within(card()).getByRole('button', { name: 'Rename Night drive' }));
    expect(card()).toHaveClass('col-span-2');
    fireEvent.change(screen.getByRole('textbox', { name: 'New name for Night drive' }), { target: { value: 'Late' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(p.onRename).toHaveBeenCalledWith('mine1', 'Late'));
    await waitFor(() => expect(card()).not.toHaveClass('col-span-2'));
  });

  it('a rename that fails says why and stays open', async () => {
    library({ onRename: vi.fn().mockResolvedValue('That name is taken') });
    fireEvent.click(within(card()).getByRole('button', { name: 'Rename Night drive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('That name is taken')).toBeInTheDocument();
    expect(card()).toHaveClass('col-span-2');
  });

  it('deleting asks first, on the whole row; Keep backs out', () => {
    const p = library();
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
    library({ cap: 1 });
    expect(within(card()).getByRole('button', { name: 'Duplicate Night drive' })).toBeDisabled();
  });

  it('on a phone the switch has its own line, so the hit boxes never leave the column', () => {
    library();
    const sw = within(card()).getByRole('switch');
    const rename = within(card()).getByRole('button', { name: 'Rename Night drive' });
    expect(sw.parentElement).not.toBe(rename.parentElement);
    expect(sw.parentElement).toHaveClass('w-full', 'md:w-auto');
    expect(rename.parentElement).toHaveClass('w-full', 'md:w-auto');
  });
});

describe('ThemeLibrary, other people’s themes as cards', () => {
  it('sit in the grid and keep Copy and Preview', () => {
    const p = library();
    const card = screen.getByTestId('shared-theme');
    expect(card.parentElement).toHaveClass('grid', 'grid-cols-2');
    expect(card).toHaveTextContent('by Luka');
    fireEvent.click(within(card).getByRole('button', { name: 'Copy Cold brew to my themes' }));
    expect(p.onCopyShared).toHaveBeenCalledWith('their1');
    fireEvent.click(within(card).getByRole('button', { name: 'Preview Cold brew' }));
    expect(p.onUse).toHaveBeenCalledWith('their1');
  });

  it('the one showing is ember and its button says so', () => {
    library({ shownPreset: null, shownThemeId: 'their1' });
    const card = screen.getByTestId('shared-theme');
    expect(card).toHaveClass('border-ember');
    expect(within(card).getByRole('button', { name: 'Preview Cold brew' })).toHaveTextContent('Showing');
  });
});
