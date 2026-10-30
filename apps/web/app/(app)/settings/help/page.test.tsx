import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SettingsHelp from './page';
import { useSettingsStore } from '@/stores/useSettingsStore';

vi.mock('@/components/RequestDialog', () => ({ RequestDialog: () => null }));

describe('Settings > Help', () => {
  it('has the crash report switch as a role=switch bound to autoReportEnabled', () => {
    render(<SettingsHelp />);
    const before = useSettingsStore.getState().autoReportEnabled;
    const sw = screen.getByRole('switch', {
      name: before ? 'Turn off automatic crash reports' : 'Turn on automatic crash reports',
    });
    expect(sw).toHaveAttribute('aria-checked', String(before));
    fireEvent.click(sw);
    expect(useSettingsStore.getState().autoReportEnabled).toBe(!before);
  });
});
