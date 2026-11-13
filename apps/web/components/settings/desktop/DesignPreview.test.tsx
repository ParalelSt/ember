// TEMPORARY: goes with DesignPreview.tsx, delete both once the owner picks.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import {
  DEFAULT_DESIGN,
  DESIGN_STORAGE_KEY,
  DesignPreviewSwitcher,
  designFromSearch,
  setSettingsDesign,
  useDesignFromUrl,
  useSettingsDesign,
} from './DesignPreview';

const stored = () => JSON.parse(localStorage.getItem(DESIGN_STORAGE_KEY) ?? 'null');

beforeEach(() => localStorage.clear());
afterEach(() => window.history.replaceState(null, '', '/'));

describe('settings design preview', () => {
  it('defaults to the owner\'s A/C/A with nothing stored, or with something broken stored', () => {
    expect(renderHook(() => useSettingsDesign()).result.current).toEqual(DEFAULT_DESIGN);
    expect(DEFAULT_DESIGN).toEqual({ layout: 'A', rows: 'C', edit: 'A' });
    localStorage.setItem(DESIGN_STORAGE_KEY, '{not json');
    expect(renderHook(() => useSettingsDesign()).result.current).toEqual(DEFAULT_DESIGN);
    localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify({ layout: 'Z', rows: 'B', edit: 7 }));
    expect(renderHook(() => useSettingsDesign()).result.current).toEqual({ layout: 'A', rows: 'B', edit: 'A' });
  });

  it('shows the three segmented controls with the current picks pressed', () => {
    render(<DesignPreviewSwitcher />);
    expect(screen.getByText('Design preview')).toBeInTheDocument();
    for (const [group, options, on] of [['Layout', 'ABCD', 'A'], ['Rows', 'ABC', 'C'], ['Edit', 'ABC', 'A']] as const) {
      const buttons = within(screen.getByRole('group', { name: group })).getAllByRole('button');
      expect(buttons.map((b) => b.textContent)).toEqual(options.split(''));
      expect(buttons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)).toEqual([on]);
    }
  });

  it('persists a pick in localStorage and keeps it for the next visit', () => {
    const view = render(<DesignPreviewSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: 'Layout C' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rows B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit C' }));
    expect(stored()).toEqual({ layout: 'C', rows: 'B', edit: 'C' });
    expect(screen.getByRole('button', { name: 'Layout C' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Layout A' })).toHaveAttribute('aria-pressed', 'false');
    view.unmount();
    render(<DesignPreviewSwitcher />);
    expect(screen.getByRole('button', { name: 'Layout C' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Edit C' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('updates every reader when one changes, including another tab writing storage', () => {
    const { result } = renderHook(() => useSettingsDesign());
    act(() => setSettingsDesign({ rows: 'B' }));
    expect(result.current).toEqual({ layout: 'A', rows: 'B', edit: 'A' });
    act(() => {
      localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify({ layout: 'D', rows: 'A', edit: 'B' }));
      window.dispatchEvent(new StorageEvent('storage', { key: DESIGN_STORAGE_KEY }));
    });
    expect(result.current).toEqual({ layout: 'D', rows: 'A', edit: 'B' });
  });

  it('reads ?settings=, ?rows= and ?edit= from the URL, ignoring bad values', () => {
    expect(designFromSearch('?settings=b&rows=C&edit=a')).toEqual({ layout: 'B', rows: 'C', edit: 'A' });
    expect(designFromSearch('?settings=E&rows=D&edit=')).toEqual({});
    expect(designFromSearch('?layout=D')).toEqual({ layout: 'D' });
    window.history.replaceState(null, '', '/settings?settings=D&edit=B');
    const { result } = renderHook(() => {
      useDesignFromUrl();
      return useSettingsDesign();
    });
    expect(result.current).toEqual({ layout: 'D', rows: 'C', edit: 'B' });
    expect(stored()).toEqual({ layout: 'D', rows: 'C', edit: 'B' });
  });

  it('folds down to a small pill showing the picks', () => {
    setSettingsDesign({ layout: 'B', rows: 'C', edit: 'A' });
    render(<DesignPreviewSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByRole('group', { name: 'Layout' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'B/C/A' }));
    expect(screen.getByRole('group', { name: 'Layout' })).toBeInTheDocument();
  });
});
