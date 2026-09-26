import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { usePartyEligible } from './usePartyEligible';

const shell = vi.hoisted(() => ({ kind: 'web' as 'web' | 'capacitor' | 'tauri' }));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => shell.kind }));

const coarse = (on: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q === '(pointer: coarse)' }) as MediaQueryList);

function Probe() {
  return <span data-testid="probe">{usePartyEligible() ? 'eligible' : 'not-eligible'}</span>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  shell.kind = 'web';
});

describe('usePartyEligible', () => {
  it('is eligible on a plain web browser with a mouse', () => {
    coarse(false);
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('eligible');
  });

  it('is not eligible on a touch browser', () => {
    coarse(true);
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('not-eligible');
  });

  it('is not eligible on Capacitor (the Android app)', () => {
    shell.kind = 'capacitor';
    coarse(false);
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('not-eligible');
  });

  it('is eligible on the Tauri desktop app', () => {
    shell.kind = 'tauri';
    coarse(true);
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('eligible');
  });
});
