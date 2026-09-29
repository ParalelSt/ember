import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useSettingsStore } from '@/stores/useSettingsStore';
import SettingsPlugins from './page';

// The Songsterr card is a real toggle bound to tabsEnabled, tagged Work in
// progress. TikTok stays a Coming soon placeholder.

// Party mode's toggle is desktop-only: hidden entirely on a phone, tablet or
// the Android app. See lib/playback/partyDevice and hooks/usePartyEligible.
const partyEligible = vi.hoisted(() => ({ value: true }));
vi.mock('@/hooks/usePartyEligible', () => ({ usePartyEligible: () => partyEligible.value }));

const initial = useSettingsStore.getState();

beforeEach(() => {
  useSettingsStore.setState(initial, true);
  partyEligible.value = true;
});

describe('Settings > Plugins', () => {
  it('renders the Songsterr toggle tagged Work in progress, on by default', () => {
    render(<SettingsPlugins />);
    expect(screen.getByText('Songsterr integration')).toBeInTheDocument();
    expect(screen.getByText('Work in progress')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Turn off Songsterr integration' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking it flips tabsEnabled and aria-pressed', () => {
    render(<SettingsPlugins />);
    const toggle = screen.getByRole('button', { name: 'Turn off Songsterr integration' });
    fireEvent.click(toggle);
    expect(useSettingsStore.getState().tabsEnabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Turn on Songsterr integration' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('has a Normalize volume toggle, on by default, bound to normalizeVolume', () => {
    render(<SettingsPlugins />);
    const toggle = screen.getByRole('button', { name: 'Turn off Normalize volume' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(useSettingsStore.getState().normalizeVolume).toBe(false);
    expect(screen.getByRole('button', { name: 'Turn on Normalize volume' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('has the equalizer, off by default, with its presets and five bands', () => {
    render(<SettingsPlugins />);
    const panel = screen.getByTestId('equalizer');
    expect(screen.getByRole('button', { name: 'Turn on Equalizer' })).toHaveAttribute('aria-pressed', 'false');
    expect(panel.querySelectorAll('input[type="range"]')).toHaveLength(5);
    expect(screen.getByRole('group', { name: 'Presets' })).toBeInTheDocument();
  });

  it('leaves TikTok window as a Coming soon placeholder', () => {
    render(<SettingsPlugins />);
    expect(screen.getByText('TikTok window')).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /TikTok window/ })).toBeNull();
  });

  describe('the party-size volume slider toggle is desktop-only', () => {
    it('shows it, bound to partyVolume, on an eligible device', () => {
      render(<SettingsPlugins />);
      const toggle = screen.getByRole('button', { name: 'Turn on Party-size volume slider' });
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(toggle);
      expect(useSettingsStore.getState().partyVolume).toBe(true);
      expect(screen.getByRole('button', { name: 'Turn off Party-size volume slider' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('hides it entirely on a phone, tablet or the Android app', () => {
      partyEligible.value = false;
      render(<SettingsPlugins />);
      expect(screen.queryByText('Party-size volume slider')).toBeNull();
      expect(
        screen.queryByRole('button', { name: /Party-size volume slider/ }),
      ).toBeNull();
    });
  });
});
