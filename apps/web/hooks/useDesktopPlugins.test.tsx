import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useDesktopPlugins } from './useDesktopPlugins';
import { usePartyEligible } from './usePartyEligible';

function Probe() {
  const desktop = useDesktopPlugins();
  const party = usePartyEligible();
  return <span>{desktop ? 'tabs allowed' : 'tabs blocked'}; {party ? 'party allowed' : 'party blocked'}</span>;
}

afterEach(() => vi.unstubAllGlobals());

describe('desktop plugin eligibility', () => {
  it.each([
    [767, false, 'tabs blocked'],
    [768, false, 'tabs allowed'],
    [1280, false, 'tabs allowed'],
    [1280, true, 'tabs blocked'],
  ])('checks width %i and native shell %s', (width, native, expected) => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => native });
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 767px)' && width < 768 }));
    render(<Probe />);
    expect(screen.getByText(new RegExp(expected))).toBeInTheDocument();
  });

  it('blocks a phone browser even in a wide landscape window', () => {
    vi.stubGlobal('navigator', { userAgent: 'iPhone Mobile' });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    render(<Probe />);
    expect(screen.getByText('tabs blocked; party blocked')).toBeInTheDocument();
  });

  it('updates both gates on resize and removes listeners on unmount', () => {
    let narrow = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (q: string) => ({
      get matches() { return q === '(max-width: 767px)' && narrow; },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }));
    const view = render(<Probe />);
    expect(screen.getByText('tabs allowed; party allowed')).toBeInTheDocument();
    act(() => { narrow = true; listeners.forEach((listener) => listener()); });
    expect(screen.getByText('tabs blocked; party blocked')).toBeInTheDocument();
    act(() => { narrow = false; listeners.forEach((listener) => listener()); });
    expect(screen.getByText('tabs allowed; party allowed')).toBeInTheDocument();
    view.unmount();
    expect(listeners.size).toBe(0);
  });
});
