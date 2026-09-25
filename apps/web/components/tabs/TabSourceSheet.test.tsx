import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { TabSheetRow } from '@/lib/tabPick';
import { TabSourceSheet } from './TabSourceSheet';

/** The Source sheet: what each kind of source
 *  looks like, what it says about the alignment, which actions a row
 *  offers, and the side sheet against the bottom sheet. Rows come in ready
 *  made (lib/tabPick.test.ts covers how they are worked out). */

function row(over: Partial<TabSheetRow> & { id: string }): TabSheetRow {
  return {
    group: 'server',
    groupLabel: 'On this server',
    type: 'Guitar Pro file',
    name: 'Copper Sky',
    rating: '',
    instruments: [],
    confidence: null,
    linedUp: false,
    status: 'Not lined up yet',
    badge: null,
    addedBy: 'added by Mira',
    drawn: false,
    canDelete: false,
    canLineUp: true,
    aligning: false,
    ...over,
  };
}

const SONGSTERR = row({
  id: 's',
  group: 'songsterr',
  groupLabel: 'Songsterr',
  type: 'Tab with rhythm',
  instruments: ['Rhythm Guitar', 'Lead Guitar', 'Bass'],
  confidence: 94,
  linedUp: true,
  status: 'Lined up 94%',
  badge: 'Best match',
  addedBy: null,
  drawn: true,
});

const UG = row({
  id: 'u',
  group: 'ug',
  groupLabel: 'Ultimate Guitar',
  type: 'Text tab',
  name: 'Copper Sky (ver 2)',
  rating: '★ 4.8 (1,204 votes)',
  instruments: ['Guitar'],
  confidence: 41,
  status: 'Not lined up yet',
  addedBy: null,
});

function sheet(over: Partial<Parameters<typeof TabSourceSheet>[0]> = {}) {
  const props = {
    open: true,
    phone: false,
    title: 'Copper Sky',
    artist: 'Coastline',
    rows: [SONGSTERR, UG],
    onPick: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<TabSourceSheet {...props} />);
  return props;
}

describe('TabSourceSheet', () => {
  it('draws nothing until it is opened', () => {
    sheet({ open: false });
    expect(screen.queryByTestId('tab-source-sheet')).toBeNull();
  });

  it('is a side sheet on desktop and a bottom sheet on phone', () => {
    const { unmount } = render(
      <TabSourceSheet open phone={false} title="Copper Sky" artist="Coastline" rows={[SONGSTERR]} onPick={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByTestId('tab-source-sheet').tagName).toBe('ASIDE');
    unmount();
    render(
      <TabSourceSheet open phone title="Copper Sky" artist="Coastline" rows={[SONGSTERR]} onPick={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByTestId('tab-source-sheet').dataset.phone).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Choose a tab' })).toBeInTheDocument();
  });

  it('lists every source under its site, with the type, rating, instruments and how it lines up', () => {
    sheet();
    expect(screen.getByText('Songsterr')).toBeInTheDocument();
    expect(screen.getByText('Ultimate Guitar')).toBeInTheDocument();
    expect(screen.getByText('2 tabs, 2 found online')).toBeInTheDocument();
    const rows = screen.getAllByTestId('tab-source-row');
    expect(rows.map((r) => r.dataset.tabId)).toEqual(['s', 'u']);
    expect(rows[0]).toHaveTextContent('Tab with rhythm');
    expect(rows[0]).toHaveTextContent('Lined up 94%');
    expect(rows[0]).toHaveTextContent('Best match');
    expect(rows[0]).toHaveTextContent('Rhythm Guitar');
    expect(within(rows[0]).getByRole('radio')).toHaveAttribute('aria-checked', 'true');
    expect(rows[1]).toHaveTextContent('★ 4.8 (1,204 votes)');
    expect(rows[1]).toHaveTextContent('Not lined up yet');
    expect(within(rows[1]).getByRole('radio')).toHaveAttribute('aria-checked', 'false');
  });

  it('names who added a tab on this server', () => {
    sheet({ rows: [row({ id: 'p', type: 'Pasted text tab', addedBy: 'pasted by you' })] });
    expect(screen.getByTestId('tab-source-row')).toHaveTextContent('pasted by you');
    expect(screen.getByText('1 tab, 0 found online')).toBeInTheDocument();
  });

  it('choosing a source hands its id back, and the close button closes', () => {
    const p = sheet();
    fireEvent.click(within(screen.getAllByTestId('tab-source-row')[1]).getByRole('radio'));
    expect(p.onPick).toHaveBeenCalledWith('u');
    fireEvent.click(screen.getAllByRole('button', { name: 'Close the tab list' })[0]);
    expect(p.onClose).toHaveBeenCalled();
  });

  it('offers Line it up on a row, and says so while the job runs', () => {
    const onLineUp = vi.fn();
    sheet({ rows: [UG, row({ id: 'busy', aligning: true, status: 'Lining it up…' })], onLineUp });
    fireEvent.click(within(screen.getAllByTestId('tab-source-row')[0]).getByRole('button', { name: 'Line it up' }));
    expect(onLineUp).toHaveBeenCalledWith('u');
    const busy = screen.getAllByTestId('tab-source-row')[1];
    expect(within(busy).getByRole('button', { name: 'Lining it up…' })).toBeDisabled();
  });

  it('never offers Line it up on a row that has no tab to line up', () => {
    sheet({ rows: [row({ id: 'generated:upload:1', canLineUp: false })], onLineUp: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Line it up' })).toBeNull();
  });

  it('offers Delete only on the rows that allow it', () => {
    const onDelete = vi.fn();
    sheet({ rows: [row({ id: 'mine', canDelete: true }), row({ id: 'theirs', canDelete: false })], onDelete });
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('mine');
  });

  it('shows no actions at all when the page hands none over', () => {
    sheet({ rows: [row({ id: 'mine', canDelete: true })] });
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Line it up' })).toBeNull();
  });

  it('says it is looking while Ember searches, with nothing to list yet', () => {
    sheet({ rows: [], searching: true });
    expect(screen.getByText('Looking online…')).toBeInTheDocument();
    expect(screen.getByTestId('tab-source-checks')).toHaveTextContent('Songsterr');
    expect(screen.queryByTestId('tab-source-row')).toBeNull();
  });

  it('says so calmly when there is nothing to list', () => {
    sheet({ rows: [], emptyNote: 'Ember found nothing online for this song yet.' });
    expect(screen.getAllByText('Ember found nothing online for this song yet.').length).toBeGreaterThan(0);
  });

  it('puts the page’s own actions under the list', () => {
    const search = vi.fn();
    sheet({
      actions: [
        { id: 'search', label: 'Search online again', onClick: search },
        { id: 'add', label: 'Adding…', onClick: vi.fn(), disabled: true },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search online again' }));
    expect(search).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled();
  });
});
