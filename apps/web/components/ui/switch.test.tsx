import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Switch, ToggleRow, type SwitchProps } from './switch';

describe('Switch', () => {
  it('is a switch with aria-checked and flips on click', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Thing" id="t" />);
    const sw = screen.getByRole('switch', { name: 'Thing' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveAttribute('id', 't');
    expect(sw.className).toContain('bg-muted');
    fireEvent.click(sw);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('is ember when on and reports false on the next click', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked onCheckedChange={onCheckedChange} aria-label="Thing" />);
    const sw = screen.getByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw.className).toContain('bg-ember');
    fireEvent.click(sw);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it('does nothing when disabled', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} disabled onCheckedChange={onCheckedChange} aria-label="Thing" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('outline variant uses the bordered card track when off', () => {
    render(<Switch checked={false} variant="outline" onCheckedChange={() => {}} aria-label="Thing" />);
    expect(screen.getByRole('switch').className).toContain('border-border');
  });
});

describe('Switch size', () => {
  const classes = (el: Element) => el.className.split(/\s+/);
  const desktopOf = (el: Element) => classes(el).filter((c) => !c.startsWith('max-md:'));

  it('desktop keeps its 44 by 24 track and 20px thumb, unchanged', () => {
    render(<Switch checked onCheckedChange={() => {}} aria-label="Thing" />);
    const sw = screen.getByRole('switch');
    expect(desktopOf(sw)).toEqual(
      'relative h-6 w-11 shrink-0 rounded-full transition-colors motion-reduce:transition-none disabled:opacity-50 bg-ember'.split(' '),
    );
    expect(desktopOf(sw.firstElementChild!)).toEqual(
      'absolute left-0.5 top-0.5 h-5 w-5 rounded-full shadow-sm transition-transform motion-reduce:transition-none translate-x-5 bg-ember-foreground'.split(' '),
    );
  });

  it('phones get a 52 by 30 track with a 24px thumb, 3px from the edge either way', () => {
    render(<Switch checked onCheckedChange={() => {}} aria-label="Thing" />);
    const sw = screen.getByRole('switch');
    expect(classes(sw)).toEqual(expect.arrayContaining(['max-md:h-7.5', 'max-md:w-13'])); // 30, 52
    expect(classes(sw.firstElementChild!)).toEqual(
      expect.arrayContaining(['max-md:size-6', 'max-md:left-0.75', 'max-md:top-0.75', 'max-md:translate-x-5.5']), // 24, 3, 3, 22
    );
    expect(52 - 24 - 3 - 3).toBe(22);
  });
});

describe('ToggleRow', () => {
  /** A live row, so a double toggle would show as a state back where it began. */
  function Row({ onChange, ...rest }: Partial<SwitchProps> & { onChange: (next: boolean) => void }) {
    const [on, setOn] = useState(false);
    return (
      <ToggleRow
        rowClassName="row-look"
        checked={on}
        onCheckedChange={(next) => {
          onChange(next);
          setOn(next);
        }}
        aria-label="Thing"
        {...rest}
      >
        <span>Thing</span>
      </ToggleRow>
    );
  }
  const tap = () => screen.getByTestId('toggle-row-tap');

  it('tapping the row toggles exactly once', () => {
    const onChange = vi.fn();
    render(<Row onChange={onChange} />);
    fireEvent.click(tap());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('tapping the switch toggles exactly once', () => {
    const onChange = vi.fn();
    render(<Row onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('row and switch alternate properly, each from the current state', () => {
    const onChange = vi.fn();
    render(<Row onChange={onChange} />);
    fireEvent.click(tap());
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(tap());
    expect(onChange.mock.calls.map(([v]) => v)).toEqual([true, false, true]);
  });

  it('the tap area sits before the switch and outside it, so a tap cannot reach both', () => {
    render(<Row onChange={() => {}} />);
    const sw = screen.getByRole('switch');
    expect(tap().contains(sw)).toBe(false);
    expect(sw.contains(tap())).toBe(false);
    expect(tap().nextElementSibling).toBe(sw);
  });

  it('is one control with one name: the tap area is hidden from assistive tech and focus', () => {
    render(<Row onChange={() => {}} />);
    expect(screen.getAllByRole('switch')).toHaveLength(1);
    expect(screen.getByRole('switch', { name: 'Thing' })).toBeInTheDocument();
    expect(tap()).toHaveAttribute('aria-hidden', 'true');
    expect(tap()).not.toHaveAttribute('tabindex');
    expect(tap()).not.toHaveAttribute('role');
    expect(screen.queryAllByRole('button', { hidden: true })).toEqual([]);
  });

  it('the keyboard reaches the real button: a native click from Enter or Space toggles once', () => {
    const onChange = vi.fn();
    render(<Row onChange={onChange} />);
    const sw = screen.getByRole('switch');
    expect(sw.tagName).toBe('BUTTON');
    sw.focus();
    expect(document.activeElement).toBe(sw);
    sw.click();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('desktop: the tap area is display:none from md up, and the row only gains relative', () => {
    render(<Row onChange={() => {}} />);
    expect(tap().className.split(' ')).toContain('md:hidden');
    expect(tap().parentElement!.className).toBe('relative row-look');
  });

  it('disabled: nothing to tap', () => {
    const onChange = vi.fn();
    render(<Row onChange={onChange} disabled />);
    expect(screen.queryByTestId('toggle-row-tap')).toBeNull();
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('passes its own className to the switch, not the row', () => {
    render(<Row onChange={() => {}} className="mt-0.5" id="t" />);
    expect(screen.getByRole('switch').className).toContain('mt-0.5');
    expect(screen.getByRole('switch')).toHaveAttribute('id', 't');
    expect(tap().parentElement!.className).not.toContain('mt-0.5');
  });

  it.each([
    'app/(app)/settings/plugins/page.tsx',
    'app/(app)/settings/help/page.tsx',
    'components/settings/EqualizerPanel.tsx',
    'components/settings/AutoCacheSettings.tsx',
    'components/settings/PrivacyToggles.tsx',
    'components/changelog/HideTagsSwitch.tsx',
  ])('%s uses ToggleRow, no bare Switch left in a label row', (rel) => {
    const src = readFileSync(join(__dirname, '..', '..', rel), 'utf8');
    expect(src).toContain('<ToggleRow');
    expect(src).not.toMatch(/<Switch\b/);
  });
});
