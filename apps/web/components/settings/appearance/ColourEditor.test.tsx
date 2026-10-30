import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ColourEditor, type ColourEditorProps } from './ColourEditor';
import { PRESET_BY_ID } from '@/lib/theme/presets';
import { hexToOklch, oklchToHex, roundOklch } from '@/lib/theme/oklch';
import type { MoreKey } from '@/lib/theme/editor';

function setup(over: Partial<ColourEditorProps> = {}) {
  const props: ColourEditorProps = {
    inputs: PRESET_BY_ID.ember.inputs,
    pinned: new Set<MoreKey>(),
    findings: [],
    baseName: 'Ember',
    canReset: false,
    onChange: vi.fn(),
    onUnpin: vi.fn(),
    onFix: vi.fn(),
    onReset: vi.fn(),
    ...over,
  };
  render(<ColourEditor {...props} />);
  return props;
}

const swatch = (name: string) => screen.getByRole('button', { name });
const panel = () => screen.getByTestId('colour-panel');

describe('ColourEditor', () => {
  it('shows every colour as a swatch with its name, under the group headings', () => {
    setup();
    expect(screen.getByText('Basics')).toBeInTheDocument();
    expect(screen.getByText('More')).toBeInTheDocument();
    expect(screen.getAllByTestId('colour-swatch').map((s) => s.getAttribute('aria-label'))).toEqual([
      'Background',
      'Accent',
      'Text',
      'Surface, auto',
      'Muted text, auto',
      'Accent hover, auto',
      'Border, auto',
      'Sidebar, auto',
    ]);
  });

  it('lays the swatches out 3 across and 2 on a narrow phone', () => {
    setup();
    const grid = swatch('Background').parentElement!;
    expect(grid.className).toContain('grid-cols-2');
    expect(grid.className).toContain('min-[360px]:grid-cols-3');
  });

  it('paints each swatch its own colour', () => {
    const inputs = PRESET_BY_ID.ember.inputs;
    setup();
    const paint = swatch('Accent').querySelector('span') as HTMLElement;
    expect(paint.style.getPropertyValue('--swatch')).toBe(oklchToHex(inputs.accent));
  });

  it('starts on Background, marks one selection and moves it with a tap', () => {
    setup();
    expect(swatch('Background')).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel()).getByLabelText('Background hex')).toBeInTheDocument();
    fireEvent.click(swatch('Accent'));
    expect(swatch('Background')).toHaveAttribute('aria-pressed', 'false');
    expect(swatch('Accent')).toHaveAttribute('aria-pressed', 'true');
    expect(swatch('Accent').querySelector('span')?.className).toContain('outline-ember');
    expect(within(panel()).getByLabelText('Accent hex')).toBeInTheDocument();
    expect(screen.queryByLabelText('Background hex')).toBeNull();
    expect(screen.getAllByTestId('colour-row')).toHaveLength(1);
  });

  it('the swatches are real buttons with a visible focus ring, and name the panel they control', () => {
    setup();
    const s = swatch('Text');
    expect(s.tagName).toBe('BUTTON');
    expect(s.className).toContain('focus-visible:ring-3');
    expect(s).toHaveAttribute('aria-controls', panel().id);
  });

  it('the panel sits under both grids', () => {
    setup();
    expect(swatch('Sidebar, auto').compareDocumentPosition(panel()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the colour picker and a valid hex change the selected colour', () => {
    const props = setup();
    fireEvent.click(swatch('Accent'));
    fireEvent.change(screen.getByLabelText('Accent colour'), { target: { value: '#112233' } });
    expect(props.onChange).toHaveBeenLastCalledWith('accent', roundOklch(hexToOklch('#112233')));
    const hex = screen.getByLabelText('Accent hex');
    fireEvent.change(hex, { target: { value: '#445566' } });
    fireEvent.blur(hex);
    expect(props.onChange).toHaveBeenLastCalledWith('accent', roundOklch(hexToOklch('#445566')));
  });

  it('an invalid hex says so and changes nothing; the message stays with its colour', () => {
    const props = setup();
    const hex = screen.getByLabelText('Background hex');
    fireEvent.change(hex, { target: { value: 'purple' } });
    fireEvent.blur(hex);
    expect(screen.getByText('Use a colour like #1a2b3c.')).toBeInTheDocument();
    expect(props.onChange).not.toHaveBeenCalled();
    fireEvent.click(swatch('Text'));
    expect(screen.queryByText('Use a colour like #1a2b3c.')).toBeNull();
  });

  it('a half-typed hex does not carry over to the next colour', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Background hex'), { target: { value: '#12' } });
    fireEvent.click(swatch('Text'));
    expect((screen.getByLabelText('Text hex') as HTMLInputElement).value).toBe(oklchToHex(PRESET_BY_ID.ember.inputs.text));
  });

  it('a Basic has no Auto pill; a More colour follows the basics until pinned', () => {
    setup();
    expect(screen.queryByRole('button', { name: /follows the basics/ })).toBeNull();
    fireEvent.click(swatch('Surface, auto'));
    expect(screen.getByRole('button', { name: 'Surface follows the basics' })).toBeDisabled();
  });

  it('a pinned More colour has no Auto mark and its Reset unpins it', () => {
    const props = setup({ pinned: new Set<MoreKey>(['surface']) });
    fireEvent.click(swatch('Surface'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset Surface to follow the basics' }));
    expect(props.onUnpin).toHaveBeenCalledWith('surface');
  });

  it('someone else\'s theme can be looked through, read-only', () => {
    const props = setup({ owner: 'Luka' });
    expect(screen.getByTestId('read-only-note')).toHaveTextContent('Only Luka can change it.');
    fireEvent.click(swatch('Accent'));
    expect(swatch('Accent')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Accent colour')).toBeDisabled();
    expect(screen.getByLabelText('Accent hex')).toHaveAttribute('readonly');
    fireEvent.click(swatch('Surface, auto'));
    expect(screen.getByRole('button', { name: 'Surface follows the basics' })).toBeDisabled();
    expect(props.onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Reset to/ })).toBeNull();
  });
});
