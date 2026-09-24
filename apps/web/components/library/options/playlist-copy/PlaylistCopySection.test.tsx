import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PlaylistCopySection } from './PlaylistCopySection';
import { COPY_OPTIONS, COPY_STEPS, type CopyOptionId } from '.';

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx); ShellPreview's nav bits all use it.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const IDS = COPY_OPTIONS.map((o) => o.id);

function shells() {
  return screen.getAllByTestId('shell-preview');
}

/** The desktop frame and the phone frame, in that order. */
function frames() {
  const [desktop, phone] = shells();
  return { desktop: within(desktop), phone: within(phone) };
}

describe('PlaylistCopySection', () => {
  it('renders every candidate at a desktop and a phone width, at every step', () => {
    for (const id of IDS) {
      for (const s of COPY_STEPS) {
        const { unmount } = render(<PlaylistCopySection option={id} step={s.id} />);
        const all = shells();
        expect(all.map((x) => x.dataset.phone)).toEqual(['false', 'true']);
        for (const shell of all) expect(within(shell).getByTestId(`copy-candidate-${id}`)).toBeInTheDocument();
        unmount();
      }
    }
  });

  it.each(IDS)('%s: the step picker puts both frames at the step', (id: CopyOptionId) => {
    const at = (step: (typeof COPY_STEPS)[number]['id']) => {
      const r = render(<PlaylistCopySection option={id} step={step} />);
      return { ...frames(), unmount: r.unmount };
    };

    // Select one by one: three picked.
    let f = at('select');
    for (const frame of [f.desktop, f.phone]) {
      const rows = frame.getAllByTestId('copy-row');
      expect(rows.filter((r) => r.dataset.selected === 'true')).toHaveLength(3);
      expect(frame.getByTestId('copy-selection-count').textContent).toMatch(/3/);
    }
    f.unmount();

    // Select all: all 15, and the control now clears.
    f = at('all');
    for (const frame of [f.desktop, f.phone]) {
      expect(frame.getAllByTestId('copy-row').every((r) => r.dataset.selected === 'true')).toBe(true);
      expect(frame.getByTestId('copy-select-all').textContent).toBe('Clear all');
    }
    f.unmount();

    // Sort: the choices are open.
    f = at('sort');
    for (const frame of [f.desktop, f.phone]) expect(frame.getByTestId('copy-sort-menu')).toBeInTheDocument();
    f.unmount();

    // Copy to: New playlist, Liked songs and the playlists.
    f = at('picker');
    for (const frame of [f.desktop, f.phone]) {
      const dests = frame.getAllByTestId('copy-destination').map((d) => d.dataset.destination);
      expect(dests).toEqual(['new', 'liked', 'gym', 'sunday', 'dad', 'alt']);
    }
    f.unmount();

    // Liked songs: the warning says plainly it likes every one of them.
    f = at('liked');
    for (const frame of [f.desktop, f.phone]) {
      const warn = frame.getByTestId('copy-liked-confirm');
      expect(warn.textContent).toMatch(/likes every one of them/);
      expect(warn.textContent).toMatch(/3 are already liked, so 12 songs get a new like/);
      expect(within(warn).getByRole('button', { name: /Like 12 songs/ })).toBeInTheDocument();
    }
    f.unmount();

    // Result.
    f = at('result');
    for (const frame of [f.desktop, f.phone]) {
      expect(frame.getByTestId('copy-result-line').textContent).toBe('Added 12, skipped 3 already there');
    }
    f.unmount();
  });

  it.each(IDS)('%s: click through the whole flow from the page', (id: CopyOptionId) => {
    render(<PlaylistCopySection option={id} step="start" />);
    const desktop = within(shells()[0]);

    // Enter select mode. Candidate (b) starts from a cover tap.
    if (id === 'tap-select') {
      fireEvent.contextMenu(desktop.getAllByTestId('copy-row')[1]);
    } else {
      fireEvent.click(desktop.getByTestId('copy-enter'));
    }
    const picked = () => desktop.getAllByTestId('copy-row').filter((r) => r.dataset.selected === 'true').length;
    if (id !== 'tap-select') fireEvent.click(desktop.getAllByTestId('copy-row')[1]);
    expect(picked()).toBe(1);

    // One more by one, then all, then clear, then all again.
    fireEvent.click(desktop.getAllByTestId('copy-row')[2]);
    expect(picked()).toBe(2);
    fireEvent.click(desktop.getByTestId('copy-select-all'));
    expect(picked()).toBe(15);
    fireEvent.click(desktop.getByTestId('copy-select-all'));
    expect(picked()).toBe(0);
    fireEvent.click(desktop.getByTestId('copy-select-all'));

    // Sort by title, Z to A: the first row is the last title.
    fireEvent.click(desktop.getByTestId('copy-sort'));
    fireEvent.click(desktop.getByRole('button', { name: 'Title, Z to A' }));
    expect(desktop.getAllByTestId('copy-row')[0].textContent).toMatch(/^Звезда/);

    // Copy into Gym: 2 of the 15 are already there.
    fireEvent.click(desktop.getByTestId('copy-to'));
    const gym = desktop.getAllByTestId('copy-destination').find((d) => d.dataset.destination === 'gym')!;
    expect(gym.textContent).toMatch(/2 already there, 13 to add/);
    fireEvent.click(gym);
    expect(desktop.getByTestId('copy-result-line').textContent).toBe('Added 13, skipped 2 already there');
  });

  it.each(IDS)('%s: Liked songs asks first, and Cancel likes nothing', (id: CopyOptionId) => {
    render(<PlaylistCopySection option={id} step="picker" />);
    const desktop = within(shells()[0]);
    const liked = () => desktop.getAllByTestId('copy-destination').find((d) => d.dataset.destination === 'liked')!;
    expect(liked().textContent).toMatch(/3 already liked, 12 to add/);
    fireEvent.click(liked());
    expect(desktop.queryByTestId('copy-result')).toBeNull();
    fireEvent.click(within(desktop.getByTestId('copy-liked-confirm')).getByRole('button', { name: 'Cancel' }));
    expect(desktop.queryByTestId('copy-liked-confirm')).toBeNull();
    expect(desktop.queryByTestId('copy-result')).toBeNull();

    // Again, and confirm this time.
    if (!desktop.queryAllByTestId('copy-destination').length) fireEvent.click(desktop.getByTestId('copy-to'));
    fireEvent.click(liked());
    fireEvent.click(desktop.getByTestId('copy-liked-yes'));
    expect(desktop.getByTestId('copy-result-line').textContent).toBe('Added 12, skipped 3 already there');
  });

  it('a new playlist takes a name and gets every picked song', () => {
    render(<PlaylistCopySection option="checkbox-bar" step="picker" />);
    const desktop = within(shells()[0]);
    fireEvent.click(desktop.getAllByTestId('copy-destination').find((d) => d.dataset.destination === 'new')!);
    const name = desktop.getByRole('textbox', { name: 'New playlist name' });
    expect(name).toHaveValue('Late Night Drive (copy)');
    fireEvent.change(name, { target: { value: 'Night bus' } });
    fireEvent.click(desktop.getByRole('button', { name: 'Create' }));
    expect(desktop.getByTestId('copy-result-line').textContent).toBe('Added 15');
    expect(desktop.getByTestId('copy-result').textContent).toMatch(/In Night bus/);
  });

  it('the result names what was skipped and why', () => {
    render(<PlaylistCopySection option="copy-dialog" step="result" />);
    const skipped = within(shells()[0]).getByTestId('copy-skipped');
    expect(skipped.textContent).toMatch(/Slow Static · Aftertone: already there/);
    expect(skipped.textContent).toMatch(/Harbor Lights · Coastline: already there as "Harbor Lights \(Official Video\)"/);
    expect(skipped.textContent).not.toMatch(/Home/);
  });

  it('the page list shows a heart only where the song itself is liked', () => {
    render(<PlaylistCopySection option="checkbox-bar" step="start" />);
    const rows = within(shells()[0]).getAllByTestId('track-row');
    const liked = rows.filter((r) => within(r).queryByRole('button', { name: 'Unlike' }));
    expect(liked.map((r) => within(r).getByTestId('track-row-title').textContent)).toEqual(['Slow Static', 'Harbor Lights', 'Звезда']);
  });

  it('after copying into Liked songs, every song on the page shows its heart', () => {
    render(<PlaylistCopySection option="checkbox-bar" step="result" />);
    const rows = within(shells()[0]).getAllByTestId('track-row');
    expect(rows).toHaveLength(15);
    for (const r of rows) expect(within(r).getByRole('button', { name: 'Unlike' })).toBeInTheDocument();
  });
});
