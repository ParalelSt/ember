import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from './input';
import { Textarea } from './textarea';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');
const classes = (el: HTMLElement) => el.className.split(/\s+/);

describe.each([
  ['Input', Input, 'textbox'],
  ['Textarea', Textarea, 'textbox'],
] as const)('%s, the Filled text box', (_name, Field) => {
  const renderField = (className?: string) => {
    render(<Field aria-label="f" className={className} />);
    return classes(screen.getByLabelText('f'));
  };

  it('has a fill, soft corners and side padding, and no outline at rest', () => {
    const c = renderField();
    expect(c).toContain('bg-input');
    expect(c).toContain('rounded-(--radius-field)');
    expect(c).toContain('px-3.5');
    expect(c.some((x) => x === 'border' || x.startsWith('border-'))).toBe(false);
    expect(c).not.toContain('bg-transparent');
  });

  it('focus is an ember ring, not a border change', () => {
    const c = renderField();
    expect(c).toContain('focus-visible:ring-2');
    expect(c).toContain('focus-visible:ring-ember');
    expect(c.some((x) => x.startsWith('focus-visible:border'))).toBe(false);
  });

  it('keeps an invalid field visible', () => {
    const c = renderField();
    expect(c).toContain('aria-invalid:ring-2');
    expect(c).toContain('aria-invalid:ring-destructive');
  });

  // Search bars and Radio's box set their own: nothing here may outrank them.
  it("a call site's own background, corners and ring replace the default", () => {
    const c = renderField('rounded-full bg-card border-0 focus-visible:ring-0');
    expect(c).toContain('rounded-full');
    expect(c).not.toContain('rounded-(--radius-field)');
    expect(c).toContain('bg-card');
    expect(c).not.toContain('bg-input');
    expect(c).toContain('focus-visible:ring-0');
    expect(c).not.toContain('focus-visible:ring-2');
  });

  it('has no dark: variant that would beat a call site in the dark themes', () => {
    expect(renderField().some((x) => x.startsWith('dark:'))).toBe(false);
  });
});

describe('Filled text box sizing', () => {
  it('Input is sized by height, and a call site h-* replaces it', () => {
    render(
      <>
        <Input aria-label="a" />
        <Input aria-label="b" className="h-12 pl-11" />
      </>,
    );
    expect(classes(screen.getByLabelText('a'))).toContain('h-11');
    const own = classes(screen.getByLabelText('b'));
    expect(own).toContain('h-12');
    expect(own).not.toContain('h-11');
    expect(own).toContain('pl-11');
  });

  it('Textarea has the roomier vertical padding', () => {
    render(<Textarea aria-label="t" />);
    expect(classes(screen.getByLabelText('t'))).toContain('py-[11px]');
  });

  it('the corners token is 12px', () => {
    expect(read('app/globals.css')).toContain('--radius-field: 12px;');
  });

  it('search bars and the Radio box still set their own look', () => {
    expect(read('app/(app)/search/page.tsx')).toContain('pl-11 h-12 rounded-full bg-card border-0');
    expect(read('app/(app)/radio/page.tsx')).toContain('h-12 rounded-full bg-card border-0');
    expect(read('components/search/SearchOverlay.tsx')).toContain('pl-11 rounded-full bg-card border-0');
  });

  it('the code box on the ember banner does not use an ember ring', () => {
    const src = read('components/settings/DevicesPanel.tsx');
    expect(src).toContain('focus-visible:ring-ember-foreground aria-invalid:ring-ember-foreground');
  });
});
