import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ChangelogPage } from './ChangelogPage';
import { computeNewIds, type ChangelogEntry } from '@/lib/changelog';

const entries: ChangelogEntry[] = [
  { id: 'b', version: '0.3.1', date: '2026-09-20', title: 'Second', summary: 's', bullets: ['two a', 'two b'] },
  { id: 'a', version: '0.3.0', date: '2026-09-18', title: 'First', summary: 's', bullets: ['one'], scope: 'desktop' },
];

/** The page wired to the same computation the hook uses, with the two
 *  handlers observable. */
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

const card = (title: string) => screen.getByText(title).closest('article') as HTMLElement;

describe('ChangelogPage', () => {
  it('renders every entry with its version and date, and scope when set', () => {
    render(<ChangelogPage entries={entries} newIds={new Set()} hideTags={false} onHideTagsChange={() => {}} onMarkAllRead={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: "What's new" })).toBeInTheDocument();
    expect(screen.getAllByTestId('changelog-entry')).toHaveLength(2);
    expect(within(card('Second')).getByText('0.3.1 · 2026-09-20')).toBeInTheDocument();
    expect(within(card('First')).getByText('0.3.0 · 2026-09-18 · Desktop app')).toBeInTheDocument();
    expect(within(card('Second')).getByText('two b')).toBeInTheDocument();
  });

  it('tags exactly the entries in newIds', () => {
    render(<ChangelogPage entries={entries} newIds={new Set(['b'])} hideTags={false} onHideTagsChange={() => {}} onMarkAllRead={() => {}} />);
    expect(within(card('Second')).getByTestId('new-badge')).toBeInTheDocument();
    expect(within(card('First')).queryByTestId('new-badge')).toBeNull();
  });

  it('Mark all as read is disabled when nothing is New', () => {
    render(<ChangelogPage entries={entries} newIds={new Set()} hideTags={false} onHideTagsChange={() => {}} onMarkAllRead={() => {}} />);
    expect(screen.getByRole('button', { name: /mark all as read/i })).toBeDisabled();
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

  it('the switch hides the tags without writing the seen version', () => {
    const onSeen = vi.fn();
    const onHide = vi.fn();
    render(<Harness onSeen={onSeen} onHide={onHide} />);
    const sw = screen.getByRole('button', { name: "Don't show New tags" });
    expect(sw).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(sw);
    expect(onHide).toHaveBeenCalledWith(true);
    expect(onSeen).not.toHaveBeenCalled();
    expect(sw).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryAllByTestId('new-badge')).toHaveLength(0);
    // Turning it back on brings the tags back, since nothing was marked read.
    fireEvent.click(sw);
    expect(onHide).toHaveBeenLastCalledWith(false);
    expect(screen.getAllByTestId('new-badge')).toHaveLength(1);
  });
});
