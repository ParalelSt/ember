import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
const report = vi.hoisted(() => vi.fn(async () => true));
const load = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('@/lib/versions/device', () => ({ reportDeviceSeen: report, loadDeviceInfo: load }));

import { DeviceVersionReporter } from './DeviceVersionReporter';

beforeEach(() => {
  vi.useFakeTimers();
  report.mockClear();
  load.mockClear();
  auth.user = { id: 'u1' };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('DeviceVersionReporter', () => {
  it('checks in a moment after opening, not during it', () => {
    const { container } = render(<DeviceVersionReporter />);
    expect(container).toBeEmptyDOMElement();
    expect(report).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(3000));
    expect(report).toHaveBeenCalledWith('u1');
  });

  it('checks again when the app comes back into view, not when it leaves', () => {
    render(<DeviceVersionReporter />);
    act(() => void vi.advanceTimersByTime(3000));
    report.mockClear();
    const state = vi.spyOn(document, 'visibilityState', 'get');
    state.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(report).not.toHaveBeenCalled();
    state.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('says nothing for someone signed out, but still learns the version for reports', () => {
    auth.user = null;
    render(<DeviceVersionReporter />);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(report).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalled();
  });

  it('stops when it goes away', () => {
    const { unmount } = render(<DeviceVersionReporter />);
    unmount();
    act(() => void vi.advanceTimersByTime(10_000));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(report).not.toHaveBeenCalled();
  });
});
