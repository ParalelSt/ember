import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

const actions = vi.hoisted(() => ({
  chooseOutput: vi.fn(async () => {}),
  openSystemPicker: vi.fn(async () => {}),
  chooseCastDevice: vi.fn(async () => {}),
  openCastPicker: vi.fn(async () => {}),
  stopCasting: vi.fn(async () => {}),
  refreshOutputs: vi.fn(async () => {}),
}));
vi.mock('@/lib/outputs/controller', () => actions);
// base-ui's menu and dialog bring the root's second React into a test
// render (see QueueSheet.test.tsx): plain boxes that show while open.
vi.mock('@/components/ui/dropdown-menu', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  let menu: { open: boolean; onOpenChange: (o: boolean) => void } = { open: false, onOpenChange: () => {} };
  return {
    DropdownMenu: ({ children, open, onOpenChange }: { children: ReactNode; open: boolean; onOpenChange: (o: boolean) => void }) => {
      menu = { open, onOpenChange };
      return <div>{children}</div>;
    },
    DropdownMenuTrigger: ({ children, ...rest }: ComponentProps<'button'>) => (
      <button {...rest} onClick={() => menu.onOpenChange(!menu.open)}>{children}</button>
    ),
    DropdownMenuContent: ({ children, ...rest }: { children: ReactNode }) => (menu.open ? <div role="menu" {...rest}>{children}</div> : null),
    DropdownMenuGroup: Box,
    DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div role="heading" aria-level={3}>{children}</div>,
    DropdownMenuItem: ({ children, onClick, ...rest }: ComponentProps<'div'>) => (
      <div role="menuitem" onClick={onClick} {...rest}>{children}</div>
    ),
    DropdownMenuSeparator: () => null,
  };
});
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children, ...rest }: { children: ReactNode }) => <div {...rest}>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

import { DevicesButton } from './DevicesButton';
import { useOutputStore } from '@/stores/useOutputStore';
import { useCastStore } from '@/stores/useCastStore';

const DESKTOP = {
  platform: 'desktop' as const,
  devices: [
    { id: 'system-default', name: 'System default', kind: 'computer' as const, detail: 'MacBook Pro Speakers' },
    { id: 'MacBook Pro Speakers', name: 'MacBook Pro Speakers', kind: 'computer' as const },
    { id: 'Scarlett 2i2', name: 'Scarlett 2i2', kind: 'usb' as const },
  ],
  currentId: 'system-default',
  currentName: 'MacBook Pro Speakers',
  currentKind: 'computer' as const,
  systemPicker: null,
  castDevices: null,
};

beforeEach(() => {
  Object.values(actions).forEach((f) => f.mockClear());
  useOutputStore.setState({ platform: null, devices: [], currentId: null, currentName: null, currentKind: null, systemPicker: null, castDevices: null, busy: false });
  useCastStore.setState({ path: null, availability: 'none', connection: 'idle', deviceName: null });
});

describe('DevicesButton', () => {
  it('is not there with nothing to choose', () => {
    render(<DevicesButton variant="bar" />);
    render(<DevicesButton variant="full" />);
    expect(screen.queryByTestId('devices-button')).toBeNull();
  });

  it('desktop bar: a menu of this computer’s outputs, the one in use lit, and a click switches', () => {
    useOutputStore.setState(DESKTOP);
    render(<DevicesButton variant="bar" />);
    const trigger = screen.getByRole('button', { name: 'Devices' });
    expect(trigger.className).not.toContain('text-ember');
    fireEvent.click(trigger);
    expect(actions.refreshOutputs).toHaveBeenCalled();
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('heading')).toHaveTextContent('This computer');
    const rows = within(menu).getAllByRole('menuitem');
    expect(rows.map((r) => r.textContent)).toEqual(['System defaultMacBook Pro Speakers', 'MacBook Pro Speakers', 'Scarlett 2i2']);
    expect(rows[0]).toHaveAttribute('aria-current', 'true');
    fireEvent.click(rows[2]);
    expect(actions.chooseOutput).toHaveBeenCalledWith('Scarlett 2i2');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('desktop bar: lit, and named, when the music plays on another device', () => {
    useOutputStore.setState({ ...DESKTOP, currentId: 'Scarlett 2i2', currentName: 'Scarlett 2i2', currentKind: 'usb' });
    render(<DevicesButton variant="bar" />);
    const trigger = screen.getByTestId('devices-button');
    expect(trigger).toHaveAttribute('aria-label', 'Devices: playing on Scarlett 2i2');
    expect(trigger).toHaveAttribute('title', 'Devices: playing on Scarlett 2i2');
    expect(trigger.className).toContain('text-ember');
  });

  it('phone: a sheet with the phone, the headset lit, the system switcher and the TVs; each row does its thing', () => {
    useOutputStore.setState({
      platform: 'android',
      devices: [
        { id: '2', name: 'This phone', kind: 'phone' },
        { id: '9', name: 'Pixel Buds', kind: 'bluetooth' },
      ],
      currentId: '9',
      currentName: 'Pixel Buds',
      currentKind: 'bluetooth',
      systemPicker: 'android-switcher',
      castDevices: [{ id: 'tv', name: 'Living Room TV', description: 'Chromecast', selected: false, connecting: false }],
    });
    useCastStore.setState({ path: 'android', availability: 'available' });
    render(<DevicesButton variant="full" />);
    fireEvent.click(screen.getByRole('button', { name: 'Devices: playing on Pixel Buds' }));
    expect(actions.refreshOutputs).toHaveBeenCalled();
    const list = screen.getByTestId('devices-list');
    expect(within(list).getByText('This phone', { selector: 'span' })).toBeInTheDocument();
    const buds = within(list).getByText('Pixel Buds').closest('button')!;
    expect(buds).toHaveAttribute('aria-current', 'true');
    expect(within(list).getByText('This phone', { selector: 'span' }).closest('button')).not.toHaveAttribute('aria-current');

    fireEvent.click(within(list).getByText('This phone', { selector: 'span' }));
    expect(actions.chooseOutput).toHaveBeenCalledWith('2');
    // Picking closes the sheet.
    expect(screen.queryByTestId('devices-list')).toBeNull();

    fireEvent.click(screen.getByTestId('devices-button'));
    fireEvent.click(within(screen.getByTestId('devices-list')).getByText('More devices'));
    expect(actions.openSystemPicker).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('devices-button'));
    fireEvent.click(within(screen.getByTestId('devices-list')).getByText('Living Room TV'));
    expect(actions.chooseCastDevice).toHaveBeenCalledWith('tv');
  });

  it('casting from Chrome: the TV is lit, the button too, and Stop casting stops it', () => {
    useCastStore.setState({ path: 'google', availability: 'available', connection: 'connected', deviceName: 'Living Room TV' });
    render(<DevicesButton variant="full" />);
    const button = screen.getByRole('button', { name: 'Devices: playing on Living Room TV' });
    expect(button.className).toContain('text-ember');
    fireEvent.click(button);
    const list = screen.getByTestId('devices-list');
    expect(within(list).getByText('Living Room TV').closest('button')).toHaveAttribute('aria-current', 'true');
    fireEvent.click(within(list).getByText('Stop casting'));
    expect(actions.stopCasting).toHaveBeenCalled();
  });

  it('cast only (a browser that cannot pick speakers): one row opens the cast picker', () => {
    useCastStore.setState({ path: 'google', availability: 'unknown' });
    render(<DevicesButton variant="full" />);
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }));
    fireEvent.click(within(screen.getByTestId('devices-list')).getByText('Cast to a device'));
    expect(actions.openCastPicker).toHaveBeenCalled();
  });

  it('connecting pulses', () => {
    useCastStore.setState({ path: 'android', availability: 'available', connection: 'connecting' });
    render(<DevicesButton variant="full" />);
    const b = screen.getByRole('button', { name: 'Devices: connecting to a cast device' });
    expect(b.className).toContain('animate-pulse');
  });
});

describe('DevicesButton, full player', () => {
  it('names a headset beside its icon, and is a bare icon on the phone', () => {
    useOutputStore.setState({ platform: 'ios', devices: [], currentId: 'r', currentName: 'AirPods Pro', currentKind: 'bluetooth', systemPicker: 'ios-route-picker' });
    const { rerender } = render(<DevicesButton variant="full" />);
    expect(screen.getByTestId('devices-button')).toHaveTextContent('AirPods Pro');
    useOutputStore.setState({ currentName: 'iPhone', currentKind: 'phone' });
    rerender(<DevicesButton variant="full" />);
    expect(screen.getByTestId('devices-button')).toHaveTextContent(/^$/);
    expect(screen.getByTestId('devices-button')).toHaveAccessibleName('Devices');
  });

  it('while casting, the sheet says the equalizer and leveling are off (not for AirPlay, which keeps the page’s audio)', () => {
    useCastStore.setState({ path: 'android', availability: 'available', connection: 'connected', deviceName: 'Living Room TV' });
    const { rerender } = render(<DevicesButton variant="full" />);
    expect(screen.getByTestId('devices-button')).toHaveTextContent('Living Room TV');
    fireEvent.click(screen.getByTestId('devices-button'));
    expect(screen.getByTestId('casting-note')).toHaveTextContent('The equalizer and volume leveling are off while casting.');
    useCastStore.setState({ path: 'airplay', deviceName: 'AirPlay' });
    rerender(<DevicesButton variant="full" />);
    expect(screen.getByTestId('devices-button')).toHaveTextContent('AirPlay');
    expect(screen.queryByTestId('casting-note')).toBeNull();
  });

  it('says Connecting while it connects', () => {
    useCastStore.setState({ path: 'google', availability: 'available', connection: 'connecting' });
    render(<DevicesButton variant="full" />);
    expect(screen.getByTestId('devices-button')).toHaveTextContent('Connecting');
  });
});
