import { useState, type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ChangelogPage } from './ChangelogPage';
import { ChangelogEntryPage } from './ChangelogEntryPage';
import { computeNewIds, type ChangelogEntry } from '@/lib/changelog';

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
    const sw = screen.getByRole('button', { name: "Don't show New tags" });
    expect(sw).toHaveAttribute('aria-pressed', 'false');
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
    expect(screen.getByText('0.3.0 · 2026-09-18 · Desktop app')).toBeInTheDocument();
    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: "Back to What's new" })).toHaveAttribute('href', '/whats-new');
  });

  it('shows a friendly state for an unknown entry', () => {
    render(<ChangelogEntryPage entry={undefined} />);
    expect(screen.getByTestId('changelog-missing')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: "Back to What's new" })).toBeInTheDocument();
  });
});
