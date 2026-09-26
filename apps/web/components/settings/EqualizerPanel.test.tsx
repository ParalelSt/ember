import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { autoPreampDb } from '@/lib/playback/eq';

const shell = vi.hoisted(() => ({ kind: 'web' as 'web' | 'capacitor' | 'tauri', plugin: false }));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => shell.kind }));
vi.mock('@/lib/playback/androidBackend', () => ({ androidPluginPresent: () => shell.plugin }));

const { EqualizerPanel, formatDb } = await import('./EqualizerPanel');

const initial = useSettingsStore.getState();
const eq = () => useSettingsStore.getState().equalizer;
const OFF = { enabled: false, bands: [0, 0, 0, 0, 0] };

function coarsePointer(coarse: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: coarse && q === '(pointer: coarse)' }) as MediaQueryList);
}

beforeEach(() => {
  useSettingsStore.setState(initial, true);
  useSettingsStore.setState({ equalizer: OFF, pluginsUserId: null });
  shell.kind = 'web';
  shell.plugin = false;
  coarsePointer(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EqualizerPanel', () => {
  it('the switch turns it on and off and keeps the bands', () => {
    useSettingsStore.setState({ equalizer: { enabled: false, bands: [3, 0, 0, 0, 0] } });
    render(<EqualizerPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Equalizer' }));
    expect(eq()).toEqual({ enabled: true, bands: [3, 0, 0, 0, 0] });
    fireEvent.click(screen.getByRole('button', { name: 'Turn off Equalizer' }));
    expect(eq()).toEqual({ enabled: false, bands: [3, 0, 0, 0, 0] });
  });

  it('lists the seven presets; picking one sets its bands, switches it on and marks it', () => {
    render(<EqualizerPanel />);
    const presets = within(screen.getByRole('group', { name: 'Presets' })).getAllByRole('button');
    expect(presets.map((b) => b.textContent)).toEqual([
      'Flat', 'Bass boost', 'Treble boost', 'Vocal', 'Acoustic', 'Electronic', 'Loudness',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Treble boost' }));
    expect(eq()).toEqual({ enabled: true, bands: [0, 0, 0, 4, 7] });
    expect(screen.getByRole('button', { name: 'Treble boost' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Flat' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('five bands from 60 Hz to 14 kHz, -12..+12 dB; moving one switches it on and reads as custom', () => {
    render(<EqualizerPanel />);
    const sliders = screen.getAllByRole('slider');
    expect(sliders.map((s) => s.getAttribute('aria-label'))).toEqual(['60 Hz', '230 Hz', '910 Hz', '3.6 kHz', '14 kHz']);
    for (const s of sliders) {
      expect(s).toHaveAttribute('min', '-12');
      expect(s).toHaveAttribute('max', '12');
    }
    fireEvent.change(screen.getByRole('slider', { name: '910 Hz' }), { target: { value: '4.5' } });
    expect(eq()).toEqual({ enabled: true, bands: [0, 0, 4.5, 0, 0] });
    expect(screen.getByRole('slider', { name: '910 Hz' })).toHaveAttribute('aria-valuetext', '+4.5 dB');
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('shows the automatic pre-amp, which follows the boosts', () => {
    useSettingsStore.setState({ equalizer: { enabled: true, bands: [0, 0, 6, 0, 0] } });
    render(<EqualizerPanel />);
    const want = Math.round(autoPreampDb([0, 0, 6, 0, 0]) * 10) / 10;
    expect(want).toBeLessThan(-5);
    expect(screen.getByTestId('equalizer-preamp')).toHaveTextContent(`Pre-amp ${formatDb(want)} (automatic)`);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(eq()).toEqual({ enabled: true, bands: [0, 0, 0, 0, 0] });
    expect(screen.getByTestId('equalizer-preamp')).toHaveTextContent('Pre-amp 0 dB (automatic)');
  });

  it('warns in a phone browser, where web audio can stop the music with the screen off', () => {
    coarsePointer(true);
    render(<EqualizerPanel />);
    expect(screen.getByRole('note')).toHaveTextContent(/screen turns off/);
  });

  it('does not warn on a computer, in the desktop app, or in the Android app', () => {
    const { unmount } = render(<EqualizerPanel />);
    expect(screen.queryByRole('note')).toBeNull();
    unmount();
    coarsePointer(true);
    shell.kind = 'capacitor';
    shell.plugin = true;
    const second = render(<EqualizerPanel />);
    expect(screen.queryByRole('note')).toBeNull();
    second.unmount();
    shell.kind = 'tauri';
    render(<EqualizerPanel />);
    expect(screen.queryByRole('note')).toBeNull();
  });
});
