import { useState, type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CHANGELOG_PAGE_SIZE, ChangelogPage, SCOPE_LABEL, clampPage, pageCount, pageOfEntry, whatsNewHref } from './ChangelogPage';
import { ChangelogEntryPage } from './ChangelogEntryPage';
import { CHANGELOG_SCOPES, computeNewIds, type ChangelogEntry } from '@/lib/changelog';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const entries: ChangelogEntry[] = [
  { id: 'b', version: '0.3.1', date: '2026-09-20', title: 'Second', summary: 'second summary', bullets: ['two a', 'two b'] },
  { id: 'a', version: '0.3.0', date: '2026-09-18', title: 'First', summary: 'first summary', bullets: ['one'], scope: 'desktop' },
];

function Harness({ onSeen, onHide }: { onSeen: (v: string) => void; onHide: (h: boolean) => void }) {
  const [seen, setSeen] = useState('0.3.0');
  const [hide, setHide] = useState(false);
  return (
    <ChangelogPage
      entries={entries}
      newIds={new Set(computeNewIds(entries, seen, hide))}
      hideTags={hide}
      onHideTagsChange={(h) => {
        onHide(h);
        setHide(h);
      }}
      onMarkAllRead={() => {
        onSeen('0.3.1');
        setSeen('0.3.1');
      }}
    />
  );
}

const plain = { hideTags: false, onHideTagsChange: () => {}, onMarkAllRead: () => {} };
const card = (title: string) => screen.getByText(title).closest('a') as HTMLElement;

describe('ChangelogPage', () => {
  it('renders compact cards: version and date, title, one-line summary, no bullets, no icon', () => {
    render(<ChangelogPage entries={entries} newIds={new Set()} {...plain} />);
    expect(screen.getByRole('heading', { level: 1, name: "What's new" })).toBeInTheDocument();
    expect(screen.getAllByTestId('changelog-entry')).toHaveLength(2);
    const c = card('Second');
    expect(within(c).getByText('0.3.1 · 2026-09-20')).toBeInTheDocument();
    const summary = within(c).getByText('second summary');
    expect(summary.className).toContain('truncate');
    expect(within(c).queryByText('two a')).toBeNull();
    expect(c.querySelector('svg')).toBeNull();
  });

  it('each whole card links to its entry page', () => {
    render(<ChangelogPage entries={entries} newIds={new Set()} {...plain} />);
    expect(card('Second')).toHaveAttribute('href', '/whats-new/b');
    expect(card('First')).toHaveAttribute('href', '/whats-new/a');
  });

  it('names each app scope on its entry page, one per app now that each has its own version', () => {
    const scoped: ChangelogEntry[] = [
      { id: 'w', version: '0.7.32', date: '2026-10-25', title: 'Win', summary: 's', bullets: ['x'], scope: 'windows' },
      { id: 'm', version: '0.7.32', date: '2026-10-25', title: 'Mac', summary: 's', bullets: ['x'], scope: 'macos' },
      { id: 'l', version: '0.7.32', date: '2026-10-25', title: 'Lin', summary: 's', bullets: ['x'], scope: 'linux' },
      { id: 'i', version: '0.7.32', date: '2026-10-25', title: 'Pho', summary: 's', bullets: ['x'], scope: 'ios' },
    ];
    const want = ['Windows app', 'Mac app', 'Linux app', 'iPhone app'];
    scoped.forEach((entry, i) => {
      const { unmount } = render(<ChangelogEntryPage entry={entry} />);
      expect(screen.getByText(`2026-10-25 · ${want[i]}`)).toBeInTheDocument();
      unmount();
    });
    for (const s of CHANGELOG_SCOPES) expect(SCOPE_LABEL[s], s).toBeTruthy();
  });

  it('tags exactly the entries in newIds, with a still pill', () => {
    render(<ChangelogPage entries={entries} newIds={new Set(['b'])} {...plain} />);
    const badge = within(card('Second')).getByTestId('new-badge');
    expect(badge.className).not.toMatch(/pulse|animate/);
    expect(within(card('First')).queryByTestId('new-badge')).toBeNull();
  });

  it('Mark all as read is a dimmed, disabled button when nothing is New', () => {
    render(<ChangelogPage entries={entries} newIds={new Set()} {...plain} />);
    const btn = screen.getByRole('button', { name: /mark all as read/i });
    expect(btn).toBeDisabled();
    expect(btn.className).toContain('disabled:opacity-40');
  });

  it('clicking Mark all as read calls the handler and the tags disappear', () => {
    const onSeen = vi.fn();
    const onHide = vi.fn();
    render(<Harness onSeen={onSeen} onHide={onHide} />);
    expect(screen.getAllByTestId('new-badge')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /mark all as read/i }));
    expect(onSeen).toHaveBeenCalledWith('0.3.1');
    expect(screen.queryAllByTestId('new-badge')).toHaveLength(0);
    expect(onHide).not.toHaveBeenCalled();
  });

  it('keeps the Do not show New tags switch, and it hides tags without marking read', () => {
    const onSeen = vi.fn();
    const onHide = vi.fn();
    render(<Harness onSeen={onSeen} onHide={onHide} />);
    const sw = screen.getByRole('switch', { name: "Don't show New tags" });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onHide).toHaveBeenCalledWith(true);
    expect(onSeen).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId('new-badge')).toHaveLength(0);
    fireEvent.click(sw);
    expect(screen.getAllByTestId('new-badge')).toHaveLength(1);
  });
});

describe('ChangelogEntryPage', () => {
  it('shows every bullet, the date and scope, and a back link to the list', () => {
    render(<ChangelogEntryPage entry={entries[1]} />);
    expect(screen.getByRole('heading', { level: 1, name: 'First' })).toBeInTheDocument();
    expect(screen.getByText('2026-09-18 · Desktop app')).toBeInTheDocument();
    expect(screen.getByTestId('changelog-version')).toHaveTextContent('0.3.0');
    expect(screen.getByText('first summary')).toBeInTheDocument();
    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: "Back to What's new" })).toHaveAttribute('href', '/whats-new');
  });

  it('the phone back is the shared round BackButton, handed to the top bar from md up', () => {
    render(<ChangelogEntryPage entry={entries[1]} />);
    const back = screen.getByTestId('changelog-back');
    expect(back).toHaveAttribute('data-slot', 'back-button');
    expect(back).toHaveClass('bg-secondary', 'rounded-full', 'md:hidden');
  });

  it('desktop heading row has a bold back arrow, the version, date and scope, and no caret-left icon', () => {
    render(<ChangelogEntryPage entry={entries[1]} />);
    const row = screen.getByTestId('changelog-heading-row');
    expect(row).toHaveClass('hidden', 'md:flex');
    const back = within(row).getByRole('link', { name: 'All updates' });
    expect(back).toHaveAttribute('href', '/whats-new');
    expect(back).toHaveClass('hover:text-ember');
    expect(back.querySelector('.phosphor-arrow-left-bold')).not.toBeNull();
    expect(within(row).getByTestId('changelog-heading-version')).toHaveTextContent('0.3.0');
    expect(row).toHaveTextContent('2026-09-18');
    expect(row).toHaveTextContent('Desktop app');
    expect(screen.getByTestId('changelog-entry-page').className).toContain('md:max-w-[776px]');
    // No filled triangle caret anywhere, phone bar included.
    expect(document.querySelectorAll('.phosphor-caret-left')).toHaveLength(0);
  });

  it('phone bar back button uses the bold arrow, not the filled triangle', () => {
    render(<ChangelogEntryPage entry={entries[1]} />);
    const back = within(screen.getByTestId('changelog-bar')).getByRole('link', { name: "Back to What's new" });
    expect(back.querySelector('.phosphor-arrow-left-bold')).not.toBeNull();
  });

  it('keeps the phone bar unchanged and hides it on desktop only', () => {
    render(<ChangelogEntryPage entry={entries[1]} />);
    const bar = screen.getByTestId('changelog-bar');
    expect(bar).toHaveClass('sticky', 'top-0', 'md:hidden');
    expect(within(bar).getByRole('link', { name: "Back to What's new" })).toHaveAttribute('href', '/whats-new');
    expect(within(bar).getByText("What's new")).toBeInTheDocument();
    expect(within(bar).getByTestId('changelog-version')).toHaveTextContent('0.3.0');
  });

  it('shows a friendly state for an unknown entry', () => {
    render(<ChangelogEntryPage entry={undefined} />);
    expect(screen.getByTestId('changelog-missing')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: "Back to What's new" })).toBeInTheDocument();
  });
});

describe('ChangelogEntryPage navigation', () => {
  const many: ChangelogEntry[] = Array.from({ length: 12 }, (_, i) => ({
    id: `e${i}`, version: `0.1.${20 - i}`, date: '2026-09-01', title: `T${i}`, summary: 's', bullets: ['b'],
  }));
  const swipe = (el: HTMLElement, dx: number, dy: number) => {
    fireEvent.touchStart(el, { touches: [{ clientX: 200, clientY: 200 }] });
    fireEvent.touchEnd(el, { changedTouches: [{ clientX: 200 + dx, clientY: 200 + dy }] });
  };

  it('arrow keys go to the newer and older neighbours', () => {
    const onGo = vi.fn();
    render(<ChangelogEntryPage entry={many[5]} entries={many} onGo={onGo} />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onGo).toHaveBeenLastCalledWith('e4');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onGo).toHaveBeenLastCalledWith('e6');
  });

  it('does nothing past either end', () => {
    const onGo = vi.fn();
    render(<ChangelogEntryPage entry={many[0]} entries={many} onGo={onGo} />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onGo).not.toHaveBeenCalled();
  });

  it('a clear horizontal swipe navigates, a vertical or short one does not', () => {
    const onGo = vi.fn();
    render(<ChangelogEntryPage entry={many[5]} entries={many} onGo={onGo} />);
    const root = screen.getByTestId('changelog-entry-page');
    swipe(root, -100, 10);
    expect(onGo).toHaveBeenLastCalledWith('e6');
    swipe(root, 100, 10);
    expect(onGo).toHaveBeenLastCalledWith('e4');
    onGo.mockClear();
    swipe(root, 20, 0);
    swipe(root, 80, 120);
    expect(onGo).not.toHaveBeenCalled();
  });

  it('shows a window of 7 dots with the current one marked, and tapping navigates', () => {
    const onGo = vi.fn();
    render(<ChangelogEntryPage entry={many[5]} entries={many} onGo={onGo} />);
    const dots = screen.getAllByTestId('changelog-dot');
    expect(dots).toHaveLength(7);
    expect(dots.filter((d) => d.dataset.current === 'true')).toHaveLength(1);
    fireEvent.click(dots[0]);
    expect(onGo).toHaveBeenCalledWith('e2');
  });

  it('desktop moves only through the cards: no arrow buttons, dots and hint are phone-only', () => {
    render(<ChangelogEntryPage entry={many[5]} entries={many} />);
    expect(screen.queryByRole('button', { name: 'Newer update' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Older update' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('changelog-hint-desktop')).not.toBeInTheDocument();
    expect(screen.getByTestId('changelog-dots')).toHaveClass('md:hidden');
    expect(screen.getByTestId('changelog-cards')).toHaveClass('md:grid');
  });

  it('desktop cards preview the neighbours, navigate, and show end states', () => {
    const onGo = vi.fn();
    const { unmount } = render(<ChangelogEntryPage entry={many[5]} entries={many} onGo={onGo} />);
    expect(screen.getByTestId('changelog-cards')).toHaveClass('hidden', 'md:grid');
    const n = screen.getByTestId('changelog-card-newer');
    const o = screen.getByTestId('changelog-card-older');
    expect(n).toHaveTextContent('Newer');
    expect(n).toHaveTextContent('T4');
    expect(n).toHaveTextContent('0.1.16 · 2026-09-01');
    expect(o).toHaveTextContent('T6');
    fireEvent.click(n);
    expect(onGo).toHaveBeenLastCalledWith('e4');
    fireEvent.click(o);
    expect(onGo).toHaveBeenLastCalledWith('e6');
    unmount();
    onGo.mockClear();
    const first = render(<ChangelogEntryPage entry={many[0]} entries={many} onGo={onGo} />);
    const dim = screen.getByTestId('changelog-card-newer');
    expect(dim).toHaveAttribute('data-empty', 'true');
    expect(dim).toHaveTextContent('You are up to date');
    expect(dim).toHaveTextContent('Nothing newer');
    fireEvent.click(dim);
    expect(onGo).not.toHaveBeenCalled();
    first.unmount();
    render(<ChangelogEntryPage entry={many[11]} entries={many} onGo={onGo} />);
    expect(screen.getByTestId('changelog-card-older')).toHaveTextContent('That is all');
    expect(screen.getByTestId('changelog-card-older')).toHaveTextContent('Nothing older');
  });

  it('Got it marks read and returns to the list', () => {
    const onGotIt = vi.fn();
    render(<ChangelogEntryPage entry={many[1]} entries={many} onGotIt={onGotIt} />);
    expect(screen.getByText('Seen everything in this update?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onGotIt).toHaveBeenCalledTimes(1);
  });
});

describe('ChangelogPage pages', () => {
  const many: ChangelogEntry[] = Array.from({ length: 25 }, (_, i) => ({
    id: `e${i}`,
    version: `0.${25 - i}.0`,
    date: '2026-10-01',
    title: `Update ${i}`,
    summary: `summary ${i}`,
    bullets: ['x'],
  }));
  const shownTitles = () => screen.getAllByTestId('changelog-entry').map((e) => e.querySelector('.font-semibold')?.textContent);
  const pager = () => screen.getByRole('navigation', { name: "What's new pages" });

  it('shows ten entries a page, newest first, with Previous, page numbers and Next as chips', () => {
    expect(CHANGELOG_PAGE_SIZE).toBe(10);
    render(<ChangelogPage entries={many} newIds={new Set()} {...plain} />);
    expect(shownTitles()).toEqual(many.slice(0, 10).map((e) => e.title));
    const nav = pager();
    const prev = within(nav).getByText('Previous');
    expect(prev.closest('a')).toBeNull();
    expect(prev).toHaveAttribute('aria-disabled', 'true');
    const pages = within(nav).getAllByRole('link', { name: /^Page / });
    expect(pages.map((a) => a.textContent)).toEqual(['1', '2', '3']);
    expect(pages.map((a) => a.getAttribute('href'))).toEqual(['/whats-new', '/whats-new?page=2', '/whats-new?page=3']);
    expect(pages[0]).toHaveAttribute('aria-current', 'page');
    expect(pages[0]).toHaveClass('rounded-full', 'bg-ember', 'text-ember-foreground');
    expect(pages[1]).toHaveClass('rounded-full', 'bg-secondary');
    expect(pages[1]).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: /Next/ })).toHaveAttribute('href', '/whats-new?page=2');
  });

  it('a middle page links both ways; the last page holds the rest and Next is off', () => {
    const { rerender } = render(<ChangelogPage entries={many} newIds={new Set()} page={2} {...plain} />);
    expect(shownTitles()).toEqual(many.slice(10, 20).map((e) => e.title));
    expect(within(pager()).getByRole('link', { name: /Previous/ })).toHaveAttribute('href', '/whats-new');
    expect(within(pager()).getByRole('link', { name: /Next/ })).toHaveAttribute('href', '/whats-new?page=3');
    rerender(<ChangelogPage entries={many} newIds={new Set()} page={3} {...plain} />);
    expect(shownTitles()).toEqual(many.slice(20).map((e) => e.title));
    expect(within(pager()).queryByRole('link', { name: /Next/ })).toBeNull();
    expect(within(pager()).getByText('Next')).toHaveAttribute('aria-disabled', 'true');
    expect(within(pager()).getByRole('link', { name: 'Page 3' })).toHaveAttribute('aria-current', 'page');
  });

  it('a page out of range shows the nearest one', () => {
    render(<ChangelogPage entries={many} newIds={new Set()} page={99} {...plain} />);
    expect(shownTitles()).toEqual(many.slice(20).map((e) => e.title));
  });

  it('keeps the New tags on every page and dots the pages that hold one', () => {
    render(<ChangelogPage entries={many} newIds={new Set(['e1', 'e12'])} page={1} {...plain} />);
    expect(within(card('Update 1')).getByTestId('new-badge')).toBeInTheDocument();
    expect(within(pager()).getByRole('link', { name: 'Page 2, has new updates' })).toContainElement(screen.getByTestId('page-new-dot'));
    expect(within(pager()).getByRole('link', { name: 'Page 3' })).toBeInTheDocument();
    // The current page shows its own tags, no dot on its number.
    expect(within(pager()).getByRole('link', { name: 'Page 1, has new updates' }).querySelector('[data-testid="page-new-dot"]')).toBeNull();
  });

  it('shows only seven page numbers at a time, around the current one', () => {
    const lots = Array.from({ length: 120 }, (_, i) => ({ ...many[0], id: `x${i}`, title: `T${i}` }));
    render(<ChangelogPage entries={lots} newIds={new Set()} page={9} {...plain} />);
    expect(within(pager()).getAllByRole('link', { name: /^Page / }).map((a) => a.textContent)).toEqual(['6', '7', '8', '9', '10', '11', '12']);
  });

  it('has no pager with ten entries or fewer', () => {
    render(<ChangelogPage entries={many.slice(0, 10)} newIds={new Set()} {...plain} />);
    expect(screen.getAllByTestId('changelog-entry')).toHaveLength(10);
    expect(screen.queryByRole('navigation', { name: "What's new pages" })).toBeNull();
  });

  it('page helpers: count, the URL param, the URL, and the page an entry is on', () => {
    expect([0, 1, 10, 11, 25].map(pageCount)).toEqual([1, 1, 1, 2, 3]);
    expect(clampPage(null, 25)).toBe(1);
    expect(clampPage('abc', 25)).toBe(1);
    expect(clampPage('0', 25)).toBe(1);
    expect(clampPage('-2', 25)).toBe(1);
    expect(clampPage('2', 25)).toBe(2);
    expect(clampPage('7', 25)).toBe(3);
    expect(whatsNewHref(1)).toBe('/whats-new');
    expect(whatsNewHref(3)).toBe('/whats-new?page=3');
    expect(pageOfEntry(many, 'e0')).toBe(1);
    expect(pageOfEntry(many, 'e9')).toBe(1);
    expect(pageOfEntry(many, 'e10')).toBe(2);
    expect(pageOfEntry(many, 'e24')).toBe(3);
    expect(pageOfEntry(many, 'nope')).toBe(1);
    expect(pageOfEntry(many, undefined)).toBe(1);
  });

  it("an entry's way back goes to the list's page it is on", () => {
    render(<ChangelogEntryPage entry={many[12]} entries={many} listHref="/whats-new?page=2" />);
    expect(screen.getByTestId('changelog-back')).toHaveAttribute('href', '/whats-new?page=2');
    expect(screen.getByTestId('changelog-back-desktop')).toHaveAttribute('href', '/whats-new?page=2');
  });
});
