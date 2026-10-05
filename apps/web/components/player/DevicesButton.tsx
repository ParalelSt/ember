'use client';

import { useState, type ComponentType } from 'react';
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
  chooseOutput,
  openCastPicker,
  openSystemPicker,
  refreshOutputs,
  stopCasting,
} from '@/lib/outputs/controller';
import {
  deviceSections,
  devicesButtonVisible,
  devicesLabel,
  playingOn,
  type CastSummary,
  type DeviceRow,
  type OutputSummary,
  type RowAction,
} from '@/lib/outputs/rows';
import { useCastStore } from '@/stores/useCastStore';
import { useOutputStore } from '@/stores/useOutputStore';
import { cn } from '@/lib/utils';

/** Where the music plays: one button (Spotify's device picker) in the
 *  desktop player bar and the phone's full-screen player. It lists this
 *  device's outputs (speakers, headphones; lib/outputs), the platform's own
 *  picker where it has one, and the cast devices, with the one playing lit.
 *  The bar opens a menu above it; the phone's is a labelled tool (the label
 *  names the output when it is not the phone itself) that opens a sheet
 *  from the bottom. */

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

function useSummaries(): { out: OutputSummary; cast: CastSummary } {
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
  return {
    out: { platform, devices, currentId, currentName, currentKind, systemPicker, castDevices },
    cast: { path, availability, connection, deviceName },
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
  /** `bar`: the desktop player bar (a menu); `full`: the top bar of the
   *  phone's full-screen player (a sheet). */
  variant: 'bar' | 'full';
  className?: string;
  iconClassName?: string;
}

export function DevicesButton({ variant, className, iconClassName }: Props) {
  const { out, cast } = useSummaries();
  const [open, setOpen] = useState(false);
  if (!devicesButtonVisible(out, cast)) return null;
  const label = devicesLabel(out, cast);
  const lit = cast.connection !== 'idle' || playingOn(out, cast) !== null;
  const sections = deviceSections(out, cast);
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void refreshOutputs();
  };
  const pick = (row: DeviceRow) => {
    setOpen(false);
    runAction(row.action);
  };
  const icon = <DevicesIcon className={iconClassName ?? 'h-4 w-4'} />;

  if (variant === 'bar') {
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

  const on = playingOn(out, cast);
  const casting = cast.connection === 'connected';
  return (
    <>
      {/* An icon in the full player's top bar; while the music plays
          somewhere else it is lit and names where (the headset, the TV). */}
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-label={label}
        title={label}
        data-testid="devices-button"
        className={cn(
          'inline-flex h-10 min-w-10 max-w-36 items-center justify-center gap-1.5 rounded-full px-2.5 transition-colors hover:bg-foreground/5',
          lit ? 'text-ember' : 'text-foreground/80 hover:text-foreground',
          cast.connection === 'connecting' && 'animate-pulse',
          className,
        )}
      >
        {icon}
        {(on || cast.connection === 'connecting') && (
          <span className="truncate text-xs font-semibold">{on ?? 'Connecting'}</span>
        )}
      </button>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl p-0" data-testid="devices-list">
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
    </>
  );
}
