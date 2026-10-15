import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { autoPreampDb } from '@/lib/playback/eq';

const shell = vi.hoisted(() => ({ kind: 'web' as 'web' | 'capacitor' | 'tauri', plugin: false }));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => shell.kind }));
// eqDevice asks androidBackend whether the native player is there.
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
  useSettingsStore.setState({ equalizer: OFF, pluginsUserId: null, eqChosenHere: false });
  shell.kind = 'web';
  shell.plugin = false;
  coarsePointer(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EqualizerPanel', () => {
  it('hides all settings while off and restores them with saved bands when enabled', () => {
    useSettingsStore.setState({ equalizer: { enabled: false, bands: [3, 0, 0, 0, 0] } });
    render(<EqualizerPanel />);
    const expectClosed = () => {
      expect(screen.getByText('Equalizer')).toBeVisible();
      expect(screen.getByText(/Shape the sound/)).toBeVisible();
      expect(screen.queryByRole('group', { name: 'Presets' })).toBeNull();
      expect(screen.queryByRole('slider')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
      expect(screen.getByTestId('equalizer-preamp')).not.toBeVisible();
    };
    expectClosed();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Equalizer' }));
    expect(screen.getByRole('group', { name: 'Presets' })).toBeVisible();
    expect(screen.getAllByRole('slider')).toHaveLength(5);
    expect(screen.getByRole('slider', { name: '60 Hz' })).toHaveValue('3');
    expect(screen.getByTestId('equalizer-preamp')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off Equalizer' }));
    expectClosed();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Equalizer' }));
    expect(screen.getByRole('slider', { name: '60 Hz' })).toHaveValue('3');
  });

  it('collapses the settings out of keyboard access and opts out of animation for reduced motion', () => {
    render(<EqualizerPanel />);
    const settings = screen.getByTestId('equalizer-preamp').closest('[aria-hidden]');
    expect(settings).toHaveAttribute('inert');
    expect(settings).toHaveStyle({ gridTemplateRows: '0fr' });
    expect(settings).toHaveClass('transition-[grid-template-rows]', 'motion-reduce:transition-none');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Equalizer' }));
    expect(settings).not.toHaveAttribute('inert');
    expect(settings).toHaveAttribute('aria-hidden', 'false');
    expect(settings).toHaveStyle({ gridTemplateRows: '1fr' });
    fireEvent.click(screen.getByRole('button', { name: 'Turn off Equalizer' }));
    expect(settings).toHaveAttribute('inert');
    expect(settings).toHaveStyle({ gridTemplateRows: '0fr' });
  });

  it('the switch turns it on and off and keeps the bands', () => {
    useSettingsStore.setState({ equalizer: { enabled: false, bands: [3, 0, 0, 0, 0] } });
    render(<EqualizerPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Equalizer' }));
    expect(eq()).toEqual({ enabled: true, bands: [3, 0, 0, 0, 0] });
    fireEvent.click(screen.getByRole('button', { name: 'Turn off Equalizer' }));
    expect(eq()).toEqual({ enabled: false, bands: [3, 0, 0, 0, 0] });
  });

  it('lists the seven presets; picking one sets its bands and marks it', () => {
    render(<EqualizerPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Equalizer' }));
    const presets = within(screen.getByRole('group', { name: 'Presets' })).getAllByRole('button');
    expect(presets.map((b) => b.textContent)).toEqual([
      'Flat', 'Bass boost', 'Treble boost', 'Vocal', 'Acoustic', 'Electronic', 'Loudness',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Treble boost' }));
    expect(eq()).toEqual({ enabled: true, bands: [0, 0, 0, 4, 7] });
    expect(screen.getByRole('button', { name: 'Treble boost' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Flat' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('five bands from 60 Hz to 14 kHz, -12..+12 dB; moving one reads as custom', () => {
    render(<EqualizerPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Equalizer' }));
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

  it('in a phone browser, the account being on elsewhere shows off until switched on here', () => {
    coarsePointer(true);
    useSettingsStore.setState({ equalizer: { enabled: true, bands: [7, 4, 0, 0, 0] } });
    render(<EqualizerPanel />);
    expect(screen.getByRole('note')).toHaveTextContent(/on for your other devices/);
    expect(screen.queryByRole('group', { name: 'Presets' })).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Equalizer' }));
    expect(useSettingsStore.getState().eqChosenHere).toBe(true);
    expect(eq()).toEqual({ enabled: true, bands: [7, 4, 0, 0, 0] });
    expect(screen.getByRole('button', { name: 'Turn off Equalizer' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('note')).not.toHaveTextContent(/other devices/);
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
