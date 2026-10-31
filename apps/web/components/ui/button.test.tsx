import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button, buttonVariants } from './button';

type Props = NonNullable<Parameters<typeof buttonVariants>[0]>;

const classes = (props: Props) => (buttonVariants(props) as string).split(/\s+/).filter(Boolean);
const phone = (props: Props) => classes(props).filter((c) => c.startsWith('max-md:'));
const desktop = (props: Props) => classes(props).filter((c) => !c.startsWith('max-md:'));

// The desktop classes as they were before the phone pills, copied by hand: a
// change here is a change to desktop, which has no chosen style yet.
const DESKTOP_VARIANTS: Record<NonNullable<Props['variant']>, string> = {
  default: 'bg-primary text-primary-foreground [a]:hover:bg-primary/80',
  outline:
    'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
  secondary:
    'bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
  ghost: 'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
  destructive:
    'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
  link: 'text-primary underline-offset-4 hover:underline',
  ember: 'bg-ember text-ember-foreground hover:bg-ember-soft',
};
const DESKTOP_SIZES: Record<NonNullable<Props['size']>, string> = {
  default: 'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
  xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
  sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
  lg: 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
  icon: 'size-8',
  'icon-xs': "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
  'icon-sm': 'size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg',
  'icon-lg': 'size-9',
};
const DESKTOP_BASE =
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const VARIANTS = Object.keys(DESKTOP_VARIANTS) as NonNullable<Props['variant']>[];
const SIZES = Object.keys(DESKTOP_SIZES) as NonNullable<Props['size']>[];
const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('Button on desktop', () => {
  const combos = VARIANTS.flatMap((variant) => SIZES.map((size) => ({ variant, size })));
  it.each(combos)('$variant $size has exactly the classes it had', ({ variant, size }) => {
    const want = `${DESKTOP_BASE} ${DESKTOP_VARIANTS[variant]} ${DESKTOP_SIZES[size]}`.split(' ');
    expect(desktop({ variant, size })).toEqual(want);
  });
});

describe('Button on phones', () => {
  it.each(SIZES)('%s is fully round', (size) => {
    expect(phone({ size })).toContain('max-md:rounded-full');
  });

  it.each(['default', 'lg'] as const)('%s text buttons are 44px tall with roomier sides', (size) => {
    expect(phone({ size })).toEqual(expect.arrayContaining(['max-md:h-11', 'max-md:px-4']));
  });

  it.each(['xs', 'sm', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'] as const)('%s keeps its size: dense rows', (size) => {
    expect(phone({ size })).toEqual(['max-md:rounded-full']);
  });

  it('outline has a soft fill and no outline, in dark too (dark: would otherwise win)', () => {
    expect(phone({ variant: 'outline', size: 'xs' })).toEqual(
      expect.arrayContaining([
        'max-md:border-transparent',
        'max-md:bg-secondary',
        'max-md:dark:border-transparent',
        'max-md:dark:bg-secondary',
      ]),
    );
  });

  it('secondary was already a soft fill with no border; it matches outline', () => {
    const c = classes({ variant: 'secondary' });
    expect(c).toContain('bg-secondary');
    expect(c).toContain('border-transparent');
  });

  it.each(['default', 'ember', 'destructive', 'ghost', 'secondary', 'link'] as const)('%s keeps its colours', (variant) => {
    expect(phone({ variant, size: 'icon' })).toEqual(['max-md:rounded-full']);
  });

  it('ghost has no fill at rest', () => {
    expect(classes({ variant: 'ghost' }).filter((c) => /^(max-md:)?bg-(?!clip)/.test(c))).toEqual([]);
  });

  it('a call site can pick its own phone height through Button (later class wins in cn)', () => {
    render(<Button className="h-12 max-md:h-12">Go</Button>);
    const c = screen.getByRole('button', { name: 'Go' }).className.split(' ');
    expect(c).toContain('max-md:h-12');
    expect(c).not.toContain('max-md:h-11');
  });

  it.each([
    ['components/auth/ApproveSignIn.tsx', 'h-12 max-md:h-12'],
    ['components/library/LibraryEmptyCard.tsx', 'max-md:h-auto max-md:px-[22px]'],
    ['components/track/menus/CreatePlaylistDialog.tsx', 'px-stack max-md:px-stack'],
  ])('%s keeps its own phone shape', (rel, shape) => {
    expect(read(rel)).toContain(shape);
  });
});
