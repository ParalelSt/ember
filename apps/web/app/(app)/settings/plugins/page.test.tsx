import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useSettingsStore } from '@/stores/useSettingsStore';
import SettingsPlugins from './page';

// The Songsterr card is a real toggle bound to tabsEnabled, tagged Work in
// progress. TikTok stays a Coming soon placeholder.

const initial = useSettingsStore.getState();

beforeEach(() => {
  useSettingsStore.setState(initial, true);
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

  it('leaves TikTok window as a Coming soon placeholder', () => {
    render(<SettingsPlugins />);
    expect(screen.getByText('TikTok window')).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /TikTok window/ })).toBeNull();
  });
});
