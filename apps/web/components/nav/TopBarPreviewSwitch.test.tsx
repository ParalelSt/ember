import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { TopBarPreviewSwitch, useTopBarPreview, useTopBarPreviewInit } from './TopBarPreviewSwitch';

/** PREVIEW ONLY: delete with TopBarPreviewSwitch.tsx once the owner picks a
 *  desktop top bar. */
describe('TopBarPreviewSwitch', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    useTopBarPreview.setState({ mode: 4, barH: 0 });
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('defaults to 4 (the layout as it is) with no param and nothing remembered', () => {
    renderHook(() => useTopBarPreviewInit());
    expect(useTopBarPreview.getState().mode).toBe(4);
  });

  it('takes ?topbar= and remembers it', () => {
    window.history.replaceState(null, '', '/?topbar=2');
    renderHook(() => useTopBarPreviewInit());
    expect(useTopBarPreview.getState().mode).toBe(2);
    expect(localStorage.getItem('ember-topbar-preview')).toBe('2');
  });

  it('falls back to the remembered pick, and ignores a bad param', () => {
    localStorage.setItem('ember-topbar-preview', '3');
    window.history.replaceState(null, '', '/?topbar=9');
    renderHook(() => useTopBarPreviewInit());
    expect(useTopBarPreview.getState().mode).toBe(3);
  });

  it('switches from the pill, remembers it and keeps ?topbar= in step', () => {
    window.history.replaceState(null, '', '/?topbar=1');
    render(<TopBarPreviewSwitch />);
    expect(screen.getByText('Top bar:')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(useTopBarPreview.getState().mode).toBe(3);
    expect(localStorage.getItem('ember-topbar-preview')).toBe('3');
    expect(window.location.search).toBe('?topbar=3');
    expect(screen.getByRole('button', { name: '3' }).getAttribute('aria-pressed')).toBe('true');
  });
});
