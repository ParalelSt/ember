import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import AdminCarPage from './page';
import type { AdminNativeLog } from '@/lib/api';
import type { NativeEvent } from '@/lib/logger/nativeLog';

/** The admin's "Car and Android Auto" page: the phone app's player log per
 *  device, newest first, errors highlighted, ANR and crash exits on top. */

const state = vi.hoisted(() => ({
  data: undefined as AdminNativeLog | undefined,
  isLoading: false,
  calls: [] as [string | undefined, number][],
}));

vi.mock('@/hooks/useAdmin', () => ({
  useQueryAdminNativeLog: (surface: string | undefined, hours: number) => {
    state.calls.push([surface, hours]);
    return { data: state.data, isLoading: state.isLoading, error: null };
  },
  useQueryAdminUsers: () => ({ data: [{ id: 'u1', name: 'Owner', email: 'o@ember.test', avatarUrl: null, isAdmin: true, created: '' }] }),
}));

const ev = (over: Partial<NativeEvent>): NativeEvent => ({
  ts: Date.UTC(2026, 9, 7, 11, 18, 50),
  level: 'info',
  event: 'state',
  message: 'buffering',
  surface: 'aaos',
  session: 's1',
  data: {},
  ...over,
});

const base = (): AdminNativeLog => ({
  since: 0,
  hours: 48,
  devices: [
    {
      key: 'u1|Google sdk_gcar|34',
      userId: 'u1',
      model: 'Google sdk_gcar',
      sdk: 34,
      app: '0.4.17',
      surfaces: ['aaos'],
      lastSeen: Date.UTC(2026, 9, 7, 11, 19, 0),
      counts: { error: 2, warn: 1, info: 1 },
      exits: [ev({ level: 'error', event: 'exit', message: 'last run ended: anr', data: { reason: 'anr', description: 'Input dispatching timed out' } })],
      events: [
        ev({ ts: Date.UTC(2026, 9, 7, 11, 19, 0), level: 'error', event: 'exit', message: 'last run ended: anr', data: { reason: 'anr' } }),
        ev({ ts: Date.UTC(2026, 9, 7, 11, 18, 58), level: 'error', event: 'player.error', message: 'ERROR_CODE_IO_BAD_HTTP_STATUS', data: { httpStatus: 403 } }),
        ev({ ts: Date.UTC(2026, 9, 7, 11, 18, 53), level: 'warn', event: 'play.stalled', message: 'play did not start within 8 s', data: { state: 'buffering' } }),
        ev({ ts: Date.UTC(2026, 9, 7, 11, 18, 45), event: 'play.request', message: 'play requested', data: { caller: 'com.android.car.media' } }),
      ],
    },
    {
      key: 'u1|Google Pixel 8|35',
      userId: 'u1',
      model: 'Google Pixel 8',
      sdk: 35,
      app: '0.4.17',
      surfaces: ['phone', 'android-auto'],
      lastSeen: Date.UTC(2026, 9, 7, 9, 0, 0),
      counts: { error: 0, warn: 0, info: 1 },
      exits: [],
      events: [ev({ surface: 'android-auto', message: 'ready' })],
    },
  ],
});

beforeEach(() => {
  state.data = base();
  state.isLoading = false;
  state.calls = [];
});

describe('AdminCarPage', () => {
  it('lists each device with who, where, versions and counts, the latest heard first', () => {
    render(<AdminCarPage />);
    const cards = screen.getAllByRole('article');
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['Google sdk_gcar', 'Google Pixel 8']);
    const meta = within(cards[0]).getByTestId('device-meta').textContent;
    expect(meta).toContain('Owner');
    expect(meta).toContain('Car (Android Automotive)');
    expect(meta).toContain('Android API 34');
    expect(meta).toContain('app 0.4.17');
    expect(cards[0].textContent).toContain('2 errors, 1 warning, 1 other');
    expect(within(cards[1]).getByTestId('device-meta').textContent).toContain('Phone, Android Auto');
  });

  it('shows events newest first, errors and warnings highlighted', () => {
    render(<AdminCarPage />);
    const rows = within(screen.getAllByRole('article')[0]).getAllByRole('listitem').filter((li) => li.hasAttribute('data-level'));
    expect(rows.map((r) => r.querySelector('.font-semibold')?.textContent)).toEqual(['exit', 'player.error', 'play.stalled', 'play.request']);
    expect(rows[1].className).toContain('text-destructive');
    expect(rows[1].textContent).toContain('httpStatus 403');
    expect(rows[2].className).toContain('bg-ember/10');
    expect(rows[3].className).not.toContain('destructive');
    expect(rows[3].textContent).toContain('caller com.android.car.media');
  });

  it('puts the ANR and crash reasons at the top of the device', () => {
    render(<AdminCarPage />);
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain('anr (Input dispatching timed out)');
  });

  it('filters by surface and window', () => {
    render(<AdminCarPage />);
    expect(state.calls.at(-1)).toEqual([undefined, 48]);
    fireEvent.click(screen.getByRole('button', { name: 'Android Auto' }));
    expect(state.calls.at(-1)).toEqual(['android-auto', 48]);
    expect(screen.getByRole('button', { name: 'Android Auto' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Car' }));
    expect(state.calls.at(-1)).toEqual(['aaos', 48]);
    fireEvent.click(screen.getByRole('button', { name: 'Showing the last 48 hours' }));
    expect(state.calls.at(-1)).toEqual(['aaos', 24]);
  });

  it('says so when nothing was heard', () => {
    state.data = { since: 0, hours: 48, devices: [] };
    render(<AdminCarPage />);
    expect(screen.getByText('Nothing heard from the app in the last 48 hours.')).toBeTruthy();
  });

  it('is linked from the admin tabs', async () => {
    const { readFileSync } = await import('node:fs');
    const tabs = readFileSync(`${process.cwd()}/components/admin/AdminTabs.tsx`, 'utf8');
    expect(tabs).toContain("{ href: '/admin/car', label: 'Car and Android Auto' }");
  });
});
