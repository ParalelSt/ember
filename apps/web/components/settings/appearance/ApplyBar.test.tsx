import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ApplyBar, type ApplyBarProps } from './ApplyBar';

function bar(over: Partial<ApplyBarProps> = {}) {
  const props: ApplyBarProps = {
    dirty: true,
    name: 'Midnight',
    inUseName: 'Ember',
    edited: false,
    canApply: true,
    applying: false,
    onApply: vi.fn(),
    onDiscard: vi.fn(),
    ...over,
  };
  render(<ApplyBar {...props} />);
  return props;
}

describe('ApplyBar, the soft bar', () => {
  it('something to apply: the same text and buttons on a soft block that sticks, no outline', () => {
    const p = bar();
    const el = screen.getByTestId('apply-bar');
    expect(el).toHaveClass('bg-card', 'rounded-[12px]', 'p-row', 'sticky', 'top-0', 'md:top-[calc(var(--ember-topbar-h,0px)+var(--spacing-block))]');
    expect(el.className).not.toMatch(/(^|\s)border(-|\s|$)/);
    expect(el).toHaveTextContent('Midnight shows in the preview only.');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(p.onApply).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to current' }));
    expect(p.onDiscard).toHaveBeenCalled();
  });

  it('changed colours say so', () => {
    bar({ edited: true });
    expect(screen.getByTestId('apply-bar')).toHaveTextContent('Your changes to Midnight show in the preview only.');
  });

  it('Apply is off while it cannot apply or is applying', () => {
    bar({ canApply: false });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('says Applying while it applies', () => {
    bar({ applying: true });
    expect(screen.getByRole('button', { name: 'Applying' })).toBeDisabled();
  });

  it('nothing to apply: the same soft block names the theme in use, and does not stick', () => {
    bar({ dirty: false });
    const el = screen.getByTestId('in-use-bar');
    expect(el).toHaveClass('bg-card', 'rounded-[12px]', 'p-row');
    expect(el).not.toHaveClass('sticky');
    expect(el).toHaveTextContent('In use: Ember.');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ApplyBar, bare (desktop Settings rows)', () => {
  it('drops the card, keeps the text and buttons, and sticks on the page background while there is something to apply', () => {
    bar({ bare: true });
    const el = screen.getByTestId('apply-bar');
    expect(el).not.toHaveClass('bg-card');
    expect(el).not.toHaveClass('rounded-[12px]');
    expect(el).toHaveClass('sticky', 'top-0', 'md:top-[calc(var(--ember-topbar-h,0px)+var(--spacing-block))]', 'bg-background');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('with nothing to apply, neither sticks nor has a background', () => {
    bar({ bare: true, dirty: false });
    const el = screen.getByTestId('in-use-bar');
    expect(el).not.toHaveClass('sticky');
    expect(el).not.toHaveClass('bg-background');
    expect(el).not.toHaveClass('bg-card');
    expect(el).toHaveTextContent('In use: Ember.');
  });
});

describe('ApplyBar keeps one height in every state (layout-shift pass)', () => {
  const layers = (el: HTMLElement) => [...el.children] as HTMLElement[];

  for (const [state, over] of [
    ['nothing to apply', { dirty: false }],
    ['a pick to apply', { dirty: true, edited: false }],
    ['changes to apply', { dirty: true, edited: true }],
  ] as const) {
    it(`${state}: every state's line is laid out in the same cell, only the shown one visible`, () => {
      bar(over);
      const el = screen.getByTestId(over.dirty ? 'apply-bar' : 'in-use-bar');
      expect(el).toHaveClass('grid');
      const all = layers(el);
      expect(all).toHaveLength(3);
      for (const layer of all) expect(layer).toHaveClass('col-start-1', 'row-start-1');
      const [shown, ...room] = all;
      expect(shown).not.toHaveClass('invisible');
      for (const layer of room) {
        expect(layer).toHaveClass('invisible');
        expect(layer).toHaveAttribute('aria-hidden', 'true');
        expect(layer).toHaveAttribute('inert');
      }
      // The tallest states are always there: the longest line with both buttons, and the in-use line.
      expect(room[0]).toHaveTextContent('Your changes to Midnight show in the preview only.');
      expect(room[0]!.querySelectorAll('button')).toHaveLength(2);
      expect(room[1]).toHaveTextContent('In use: Ember.');
    });
  }

  it('the unseen buttons are out of reach: only the shown ones are buttons to assistive tech', () => {
    bar({ dirty: false });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    cleanup();
    bar({ dirty: true });
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
