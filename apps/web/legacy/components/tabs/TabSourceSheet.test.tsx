import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { InstrumentChoice, VersionChoice } from '@/lib/tabChoose';
import { TabSourceSheet } from './TabSourceSheet';

/** The sheet that chooses a tab, instrument first: the tiles, the list of
 *  the chosen instrument's versions, what each row says and offers, and the
 *  side sheet against the bottom sheet. Tiles and rows come in ready made
 *  (lib/tabChoose.test.ts covers how they are worked out). */

function version(over: Partial<VersionChoice> & { id: string }): VersionChoice {
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
    rank: 1,
    track: 0,
    source: 'File',
    ...over,
  };
}

const SONGSTERR = version({
  id: 's',
  group: 'songsterr',
  groupLabel: 'Songsterr',
  type: 'Tab with rhythm',
  instruments: ['Rhythm Guitar', 'Bass'],
  confidence: 94,
  linedUp: true,
  status: 'Lined up 94%',
  addedBy: null,
  drawn: true,
  source: 'Songsterr',
  rank: 1,
  track: 0,
});
const UG = version({
  id: 'u',
  group: 'ug',
  groupLabel: 'Ultimate Guitar',
  type: 'Text tab',
  name: 'Copper Sky (ver 2)',
  rating: '★ 4.8 (1,204 votes)',
  addedBy: null,
  source: 'Ultimate Guitar',
  rank: 2,
});
const INSTRUMENTS: InstrumentChoice[] = [
  { name: 'Rhythm Guitar', key: 'rhythm guitar', count: 2 },
  { name: 'Bass', key: 'bass', count: 1 },
  { name: 'Drums', key: 'drums', count: 1 },
];

function sheet(over: Partial<Parameters<typeof TabSourceSheet>[0]> = {}) {
  const props = {
    open: true,
    phone: false,
    title: 'Copper Sky',
    artist: 'Coastline',
    instruments: INSTRUMENTS,
    instrument: 'rhythm guitar',
    onInstrument: vi.fn(),
    versions: [SONGSTERR, UG],
    current: { id: 's', track: 0 },
    onPick: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<TabSourceSheet {...props} />);
  return props;
}

describe('TabSourceSheet, instrument first', () => {
  it('draws nothing until it is opened', () => {
    sheet({ open: false });
    expect(screen.queryByTestId('tab-source-sheet')).toBeNull();
  });

  it('is a side sheet on desktop and a bottom sheet on phone', () => {
    sheet();
    expect(screen.getByTestId('tab-source-sheet')).toHaveAttribute('data-phone', 'false');
    expect(screen.getByRole('dialog', { name: 'Choose a tab' })).toBeInTheDocument();
  });

  it('on a phone the bar above it closes it', () => {
    const p = sheet({ phone: true });
    expect(screen.getByTestId('tab-source-sheet')).toHaveAttribute('data-phone', 'true');
    fireEvent.click(screen.getAllByRole('button', { name: 'Close the tab list' })[0]);
    expect(p.onClose).toHaveBeenCalled();
  });

  it('asks the instrument first: a tile each, with how many versions, the one listed pressed', () => {
    const p = sheet();
    expect(screen.getByText('What do you want to play?')).toBeInTheDocument();
    const tiles = screen.getAllByTestId('tab-instrument-tile');
    expect(tiles.map((t) => t.textContent)).toEqual(['Rhythm Guitar2 versions', 'Bass1 version', 'Drums1 version']);
    expect(tiles[0]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(tiles[1]);
    expect(p.onInstrument).toHaveBeenCalledWith('bass');
  });

  it('then that instrument’s versions, best first: rank, name, where from, how well lined up', () => {
    sheet();
    expect(screen.getByText('Rhythm Guitar, best first')).toBeInTheDocument();
    const rows = screen.getAllByTestId('tab-source-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('1');
    expect(rows[0]).toHaveTextContent('Best match');
    expect(rows[0]).toHaveTextContent('Songsterr · Tab with rhythm');
    expect(within(rows[0]).getByTestId('tab-source-status')).toHaveTextContent('Lined up 94%');
    expect(rows[1]).toHaveTextContent('Ultimate Guitar · Text tab · ★ 4.8 (1,204 votes)');
    expect(rows[1]).not.toHaveTextContent('Best match');
    expect(within(rows[1]).getByTestId('tab-source-status')).toHaveTextContent('Not lined up yet');
  });

  it('the version on screen is the checked one; a tap picks a version with its track', () => {
    const p = sheet({ versions: [SONGSTERR, { ...UG, track: 1 }] });
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    expect(radios[1]).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(radios[1]);
    expect(p.onPick).toHaveBeenCalledWith('u', 1);
  });

  it('the same tab on another instrument is not the checked one', () => {
    sheet({ current: { id: 's', track: 1 } });
    expect(screen.getAllByRole('radio')[0]).toHaveAttribute('aria-checked', 'false');
  });

  it('one version: no Best match badge', () => {
    sheet({ versions: [SONGSTERR] });
    expect(screen.queryByText('Best match')).toBeNull();
  });

  it('a version the listener picked says so', () => {
    sheet({ versions: [{ ...SONGSTERR, badge: 'Your pick' }] });
    expect(screen.getByText('Your pick')).toBeInTheDocument();
  });

  it('Line it up and Delete on the rows that allow them', () => {
    const onLineUp = vi.fn();
    const onDelete = vi.fn();
    sheet({ versions: [SONGSTERR, { ...UG, canDelete: true, aligning: true, status: 'Lining it up…' }], onLineUp, onDelete });
    const rows = screen.getAllByTestId('tab-source-row');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Line it up' }));
    expect(onLineUp).toHaveBeenCalledWith('s');
    expect(within(rows[0]).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(rows[1]).getByRole('button', { name: 'Lining it up…' })).toBeDisabled();
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('u');
  });

  it('the buttons under the list: Search online again and Add a file', () => {
    const add = vi.fn();
    sheet({
      actions: [
        { id: 'search-again', label: 'Search online again', onClick: vi.fn() },
        { id: 'add-file', label: 'Add a file', onClick: add },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add a file' }));
    expect(add).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Search online again' })).toBeInTheDocument();
  });

  it('while Ember looks online: the sites it checks and placeholders', () => {
    sheet({ instruments: [], versions: [], instrument: null, searching: true });
    expect(screen.getByTestId('tab-source-checks')).toHaveTextContent('Songsterr');
  });

  it('nothing at all: the note says so', () => {
    sheet({ instruments: [], versions: [], instrument: null, emptyNote: 'Ember found nothing online for this song yet.' });
    expect(screen.getByText('Ember found nothing online for this song yet.')).toBeInTheDocument();
  });
});
