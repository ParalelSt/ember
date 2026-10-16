import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { PlusIcon } from '@/components/icons';
import { FloatingActionButton, FLOATING_ACTION_CLASS } from './floating-action-button';

describe('FloatingActionButton', () => {
  it('is a round icon button named by aria-label', () => {
    const onClick = vi.fn();
    render(<FloatingActionButton icon={PlusIcon} aria-label="Add invite" onClick={onClick} />);
    const fab = screen.getByRole('button', { name: 'Add invite' });
    expect(fab).toHaveClass('w-12', 'rounded-full', 'bg-ember');
    expect(fab.querySelector('.phosphor-plus')).not.toBeNull();
    fireEvent.click(fab);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is a pill with its words when given a label', () => {
    render(<FloatingActionButton label="Back up now" onClick={() => {}} disabled />);
    const fab = screen.getByRole('button', { name: 'Back up now' });
    expect(fab).toHaveTextContent('Back up now');
    expect(fab).toHaveClass('px-block');
    expect(fab).not.toHaveClass('w-12');
    expect(fab).toBeDisabled();
  });

  it('floats bottom right in the content column, phone only, with one shared look', () => {
    render(<FloatingActionButton label="Go" onClick={() => {}} />);
    const fab = screen.getByRole('button', { name: 'Go' });
    for (const c of FLOATING_ACTION_CLASS.split(' ')) expect(fab).toHaveClass(c);
    expect(fab).toHaveClass('absolute', 'right-6', 'bottom-cluster', 'md:hidden');
    expect(fab).toHaveAttribute('data-fab');
  });

  it('lifts Back to top over itself on a phone only', () => {
    const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');
    const at = css.indexOf('body:has([data-fab]) [data-back-to-top]');
    expect(at).toBeGreaterThan(-1);
    const media = css.lastIndexOf('@media', at);
    expect(css.slice(media, at)).toContain('max-width: 47.99rem');
  });
});
