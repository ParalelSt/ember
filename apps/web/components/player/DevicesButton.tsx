'use client';

import { useEffect, useState, type ComponentType } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  AirplayIcon,
  BluetoothIcon,
  CarIcon,
  CastIcon,
  DevicesIcon,
  HeadphonesIcon,
  LaptopIcon,
  MoreIcon,
  PhoneIcon,
  SpeakerIcon,
  StopIcon,
  TvIcon,
  UsbIcon,
} from '@/components/icons';
import {
  chooseCastDevice,
  chooseEmberDevice,
  chooseOutput,
  chooseThisDevice,
  openCastPicker,
  openSystemPicker,
  refreshOutputs,
  stopCasting,
} from '@/lib/outputs/controller';
import {
  controlledName,
  deviceSections,
  devicesButtonVisible,
  devicesLabel,
  freshDevices,
  playingOn,
  type CastSummary,
  type DeviceRow,
  type OutputSummary,
  type RemoteSummary,
  type RowAction,
} from '@/lib/outputs/rows';
import { isPhone } from '@/lib/isPhone';
import { useCastStore } from '@/stores/useCastStore';
import { useOutputStore } from '@/stores/useOutputStore';
import { useRemoteStore } from '@/stores/useRemoteStore';
import { cn } from '@/lib/utils';

/** Where the music plays (Spotify's device picker): this device's outputs
 *  (speakers, headphones; lib/outputs), the platform's own picker where it
 *  has one, and the cast devices, with the one playing lit. The desktop
 *  player bar has a button that opens a menu above it (DevicesButton); the
 *  phone's full-screen player has a row in its More sheet
 *  (useDevicesEntry) that opens DevicesSheet from the bottom. */

const ICONS: Record<DeviceRow['icon'], ComponentType<{ className?: string }>> = {
  computer: LaptopIcon,
  phone: PhoneIcon,
  speaker: SpeakerIcon,
  headphones: HeadphonesIcon,
  bluetooth: BluetoothIcon,
  usb: UsbIcon,
  hdmi: TvIcon,
  airplay: AirplayIcon,
  car: CarIcon,
  other: SpeakerIcon,
  cast: CastIcon,
  more: MoreIcon,
  stop: StopIcon,
};

/** The picker's view of the account's other devices. */
function useRemoteSummary(): RemoteSummary {
  const devices = useRemoteStore((s) => s.devices);
  const mode = useRemoteStore((s) => s.mode);
  const target = useRemoteStore((s) => s.target);
  const now = useRemoteStore((s) => s.heardAt);
  return { devices, mode, target, now, thisKind: isPhone() ? 'phone' : 'computer' };
}

/** While the picker is open the device list is kept fresh (the remote
 *  devices hook polls faster). */
function useMarkPickerOpen(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    useRemoteStore.getState().set({ pickerOpen: true });
    return () => useRemoteStore.getState().set({ pickerOpen: false });
  }, [open]);
}

function useSummaries(): { out: OutputSummary; cast: CastSummary; remote: RemoteSummary; remoteName: string | null; others: number } {
  const platform = useOutputStore((s) => s.platform);
  const devices = useOutputStore((s) => s.devices);
  const currentId = useOutputStore((s) => s.currentId);
  const currentName = useOutputStore((s) => s.currentName);
  const currentKind = useOutputStore((s) => s.currentKind);
  const systemPicker = useOutputStore((s) => s.systemPicker);
  const castDevices = useOutputStore((s) => s.castDevices);
  const path = useCastStore((s) => s.path);
  const availability = useCastStore((s) => s.availability);
  const connection = useCastStore((s) => s.connection);
  const deviceName = useCastStore((s) => s.deviceName);
  const remote = useRemoteSummary();
  return {
    out: { platform, devices, currentId, currentName, currentKind, systemPicker, castDevices },
    cast: { path, availability, connection, deviceName },
    remote,
    remoteName: controlledName(remote),
    others: freshDevices(remote),
  };
}

function runAction(a: RowAction): void {
  switch (a.type) {
    case 'output':
      void chooseOutput(a.id);
      return;
    case 'system-picker':
      void openSystemPicker();
      return;
    case 'cast-device':
      void chooseCastDevice(a.id);
      return;
    case 'cast-picker':
      void openCastPicker();
      return;
    case 'cast-stop':
      void stopCasting();
      return;
    case 'ember-device':
      void chooseEmberDevice(a.id, a.name);
      return;
    case 'here':
      chooseThisDevice();
      return;
  }
}

function RowBody({ row }: { row: DeviceRow }) {
  const Icon = ICONS[row.icon];
  return (
    <>
      <Icon className={cn('h-4 w-4 shrink-0', row.current ? 'text-ember' : 'text-muted-foreground')} />
      <span className="flex min-w-0 flex-col text-left">
        <span className={cn('truncate', row.current && 'text-ember font-semibold')}>{row.label}</span>
        {row.detail && <span className="truncate text-xs text-muted-foreground">{row.detail}</span>}
      </span>
    </>
  );
}

interface Props {
  /** The desktop player bar's button (a menu above it). */
  variant: 'bar';
  className?: string;
  iconClassName?: string;
}

export function DevicesButton({ className, iconClassName }: Props) {
  const { out, cast, remote, remoteName, others } = useSummaries();
  const [open, setOpen] = useState(false);
  useMarkPickerOpen(open);
  if (!devicesButtonVisible(out, cast, remoteName, others)) return null;
  const label = devicesLabel(out, cast, remoteName);
  const lit = cast.connection !== 'idle' || playingOn(out, cast, remoteName) !== null;
  const sections = deviceSections(out, cast, remote);
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void refreshOutputs();
  };
  const pick = (row: DeviceRow) => {
    setOpen(false);
    runAction(row.action);
  };
  const icon = <DevicesIcon className={iconClassName ?? 'h-4 w-4'} />;

  const buttonClass = cn(
    lit ? 'text-ember hover:text-ember' : 'text-muted-foreground hover:text-foreground',
    cast.connection === 'connecting' && 'animate-pulse',
    className,
  );
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        data-testid="devices-button"
        aria-label={label}
        title={label}
        className={cn('inline-flex items-center justify-center rounded-md transition-colors hover:bg-accent', buttonClass)}
      >
        {icon}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="min-w-72 max-w-80" data-testid="devices-list">
        {sections.map((section, i) => (
          <DropdownMenuGroup key={section.key}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{section.title}</DropdownMenuLabel>
            {section.rows.map((row) => (
              <DropdownMenuItem
                key={row.key}
                onClick={() => pick(row)}
                aria-current={row.current || undefined}
                data-current={row.current || undefined}
                className="gap-row py-cluster"
              >
                <RowBody row={row} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The phone's More sheet row: whether to show it (only with somewhere
 *  else to play), what to call it, and the output it plays on when that
 *  is not the phone itself (the headset, the TV). */
export function useDevicesEntry() {
  const { out, cast, remoteName, others } = useSummaries();
  return {
    visible: devicesButtonVisible(out, cast, remoteName, others),
    label: devicesLabel(out, cast, remoteName),
    on: playingOn(out, cast, remoteName) ?? (cast.connection === 'connecting' ? 'Connecting' : null),
    lit: cast.connection !== 'idle' || playingOn(out, cast, remoteName) !== null,
  };
}

/** The phone's devices sheet, from the bottom. Opening it refreshes the
 *  list; picking a row switches and closes it. */
export function DevicesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { out, cast, remote } = useSummaries();
  const sections = deviceSections(out, cast, remote);
  const casting = cast.connection === 'connected';
  useMarkPickerOpen(open);
  useEffect(() => {
    if (open) void refreshOutputs();
  }, [open]);
  const pick = (row: DeviceRow) => {
    onOpenChange(false);
    runAction(row.action);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* The player's own sheet: its shortcuts keep working (OPEN_MODAL). */}
      <SheetContent data-player-view side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl p-0" data-testid="devices-list">
        <SheetHeader className="px-block pt-block pb-0">
          <SheetTitle className="text-base">Devices</SheetTitle>
          </SheetHeader>
          {casting && cast.path !== 'airplay' && (
            <p data-testid="casting-note" role="note" className="px-block text-xs text-muted-foreground">
              The equalizer and volume leveling are off while casting.
            </p>
          )}
          <div className="flex flex-col gap-block px-cluster pb-stack">
            {sections.map((section) => (
              <div key={section.key} className="flex flex-col">
                <div className="px-row pb-inset text-[11px] uppercase tracking-widest text-muted-foreground">{section.title}</div>
                {section.rows.map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => pick(row)}
                    aria-current={row.current || undefined}
                    data-current={row.current || undefined}
                    className="flex min-h-12 items-center gap-row rounded-lg px-row py-cluster text-sm hover:bg-accent focus-visible:bg-accent outline-none"
                  >
                    <RowBody row={row} />
                  </button>
                ))}
              </div>
            ))}
          </div>
        </SheetContent>
    </Sheet>
  );
}
