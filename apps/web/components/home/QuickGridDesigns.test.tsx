import { useEffect, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QuickGrid } from './QuickGrid';
import { parseQuickGridVariant, pickQuickGridVariant, quickGridSlots } from '@/lib/quickGrid';
import type { QuickPick } from '@/lib/home';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));

// The real sheet is base-ui's Dialog (it closes on Escape); the shared mock
// has no Escape, so this one adds it.
vi.mock('@/components/ui/sheet', async () => {
  const real = await import('@/test-utils/dialogMock');
  return {
    ...real,
    Sheet: (props: ComponentProps<typeof real.Sheet>) => {
      const { open, onOpenChange } = props;
      useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange?.(false); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [open, onOpenChange]);
      return <real.Sheet {...props} />;
    },
  };
});

const items: QuickPick[] = ['Liked songs', 'Recently played', 'Uploads', 'Mix one', 'Mix two'].map((title, i) => ({
  key: `k${i}`, title, href: `/c/${i}`, src: null, icon: 'heart',
}));

function stubWidth(width: number) {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON() {} });
}

beforeEach(() => stubWidth(1100)); // 4 tiles of 260 + gaps
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const tiles = () => within(screen.getByRole('list', { name: 'Your collections' })).getAllByRole('listitem').filter((li) => li.querySelector('a'));
const BUTTON = { a: 'All collections (5)', b: 'All collections', c: 'See all' } as const;

describe.each(['a', 'b', 'c'] as const)('quickgrid design %s', (design) => {
  it('phone: one row, 2 tiles (plus the square in b)', () => {
    render(<QuickGrid items={items} design={design} />);
    expect(tiles()).toHaveLength(2);
    expect(screen.getByRole('button', { name: BUTTON[design] })).toBeInTheDocument();
  });

  it('desktop: as many as fit, then the button', () => {
    render(<QuickGrid items={items} design={design} variant="desktop" />);
    expect(tiles()).toHaveLength(design === 'b' ? 3 : 4);
    expect(screen.getByRole('button', { name: BUTTON[design] })).toBeInTheDocument();
  });

  it('desktop: no button or menu when everything fits', () => {
    stubWidth(1500);
    render(<QuickGrid items={items} design={design} variant="desktop" />);
    expect(tiles()).toHaveLength(5);
    expect(screen.queryByRole('button', { name: BUTTON[design] })).toBeNull();
  });

  it('phone: the menu lists all, closes on a link click and on Escape', () => {
    render(<QuickGrid items={items} design={design} />);
    fireEvent.click(screen.getByRole('button', { name: BUTTON[design] }));
    const menu = screen.getByRole('dialog');
    expect(within(menu).getAllByRole('link')).toHaveLength(5);
    fireEvent.click(within(menu).getByRole('link', { name: 'Mix two' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: BUTTON[design] }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('desktop: the popover lists all, closes on link, Escape and outside click', () => {
    render(<QuickGrid items={items} design={design} variant="desktop" />);
    const open = () => fireEvent.click(screen.getByRole('button', { name: BUTTON[design] }));
    open();
    expect(within(screen.getByRole('dialog')).getAllByRole('link')).toHaveLength(5);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Uploads' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('quickgrid today', () => {
  it('no design renders every tile and no button', () => {
    render(<QuickGrid items={items} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('parses and picks the variant', () => {
    expect(parseQuickGridVariant(' B ')).toBe('b');
    expect(parseQuickGridVariant('x')).toBeNull();
    expect(pickQuickGridVariant(null, 'c')).toBe('c');
    expect(pickQuickGridVariant('a', 'c')).toBe('a');
    expect(pickQuickGridVariant(null, null)).toBe('today');
    expect(quickGridSlots(3, 2, 'b')).toEqual({ visible: 2, overflow: true });
    expect(quickGridSlots(2, 2, 'a')).toEqual({ visible: 2, overflow: false });
  });
});
