'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertIcon } from '@/components/icons';
import { EmptyState } from '@/components/page/EmptyState';
import { SectionHeader } from '@/components/page/SectionHeader';
import { useQueryAdminNativeLog, useQueryAdminUsers } from '@/hooks/useAdmin';
import type { NativeDevice, NativeEvent } from '@/lib/logger/nativeLog';
import type { NativeSurface } from '@/lib/logger/types';
import { cn } from '@/lib/utils';

const SURFACE_LABELS: Record<NativeSurface, string> = {
  phone: 'Phone',
  'android-auto': 'Android Auto',
  aaos: 'Car (Android Automotive)',
  desktop: 'Desktop app',
};

const FILTERS: { value: NativeSurface | undefined; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'android-auto', label: 'Android Auto' },
  { value: 'aaos', label: 'Car' },
  { value: 'phone', label: 'Phone' },
  { value: 'desktop', label: 'Desktop' },
];

function when(ts: number): string {
  return new Date(ts).toLocaleString();
}

/** A few data fields after the message, as `key value`. */
function details(data: Record<string, unknown>): string {
  return Object.entries(data)
    .filter(([k, v]) => k !== 'deviceTs' && v !== null && typeof v !== 'object')
    .slice(0, 6)
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(' · ');
}

function EventRow({ e }: { e: NativeEvent }) {
  const info = details(e.data);
  return (
    <li
      data-level={e.level}
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] gap-row px-row py-cluster rounded-md text-sm',
        e.level === 'error' && 'bg-destructive/10 text-destructive',
        e.level === 'warn' && 'bg-ember/10',
      )}
    >
      <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{when(e.ts)}</span>
      <div className="min-w-0">
        <div className="break-words">
          <span className="font-semibold">{e.event}</span> {e.message}
        </div>
        <div className="text-xs text-muted-foreground break-words">
          {SURFACE_LABELS[e.surface]}
          {info && ` · ${info}`}
        </div>
      </div>
    </li>
  );
}

function DeviceCard({ d, who }: { d: NativeDevice; who: string }) {
  return (
    <article className="flex flex-col gap-cluster rounded-lg bg-card px-row py-cluster" aria-label={d.model}>
      <header>
        <h3 className="font-semibold">{d.model}</h3>
        <p className="text-xs text-muted-foreground" data-testid="device-meta">
          {who} · {d.surfaces.map((s) => SURFACE_LABELS[s]).join(', ')}
          {d.sdk !== null && ` · Android API ${d.sdk}`}
          {d.app && ` · app ${d.app}`} · last heard {when(d.lastSeen)}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {d.counts.error} {d.counts.error === 1 ? 'error' : 'errors'}, {d.counts.warn}{' '}
          {d.counts.warn === 1 ? 'warning' : 'warnings'}, {d.counts.info} other
        </p>
      </header>
      {d.exits.length > 0 && (
        <div role="alert" className="flex gap-cluster items-start rounded-md bg-destructive/10 text-destructive px-row py-cluster text-sm">
          <AlertIcon className="h-4 w-4 mt-inset shrink-0" />
          <ul>
            {d.exits.map((x) => (
              <li key={`${x.ts}-${x.message}`}>
                {when(x.ts)}: {String(x.data.reason ?? x.message)}
                {typeof x.data.description === 'string' && ` (${x.data.description})`}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ol className="flex flex-col gap-inset">
        {d.events.map((e, i) => (
          <EventRow key={`${e.ts}-${i}`} e={e} />
        ))}
      </ol>
    </article>
  );
}

/** What the phone app's player did, sent by the app itself (PlaybackLog.kt,
 *  POST /api/native-log): in Android Auto and in a car running Android no
 *  page is open, so this is the only log of it. Per device, the latest heard
 *  first, each newest event first; errors in red, warnings in the ember accent, and
 *  the app's last runs that ended in an ANR or a crash at the top. */
export default function AdminCarPage() {
  const [surface, setSurface] = useState<NativeSurface | undefined>(undefined);
  const [hours, setHours] = useState<24 | 48>(48);
  const { data, isLoading, error } = useQueryAdminNativeLog(surface, hours);
  const { data: users } = useQueryAdminUsers();
  const nameOf = (id: string) => {
    const u = users?.find((x) => x.id === id);
    return u ? u.name || u.email : id;
  };

  return (
    <section className="flex flex-col gap-section">
      <div>
        <SectionHeader title="Car and Android Auto" className="mb-cluster" />
        <p className="text-sm text-muted-foreground">
          The phone app reports what its player does: plays asked for, whether they started, audio focus, player
          errors, and why the app last stopped (an ANR or a crash). It sends this even with no screen open, which is
          all Android Auto and a car running Android ever have. Kept for two days.
        </p>
      </div>

      <div className="flex flex-wrap gap-cluster items-center" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <Button
            key={f.label}
            size="sm"
            variant={surface === f.value ? 'secondary' : 'ghost'}
            aria-pressed={surface === f.value}
            onClick={() => setSurface(f.value)}
          >
            {f.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setHours(hours === 48 ? 24 : 48)}
          aria-label={`Showing the last ${hours} hours`}
        >
          Last {hours} hours
        </Button>
      </div>

      {isLoading && <EmptyState>Loading…</EmptyState>}
      {error && <EmptyState>Couldn&apos;t load the log: {(error as Error).message}</EmptyState>}
      {data && data.devices.length === 0 && (
        <EmptyState>Nothing heard from the app in the last {data.hours} hours.</EmptyState>
      )}
      {data?.devices.map((d) => (
        <DeviceCard key={d.key} d={d} who={nameOf(d.userId)} />
      ))}
    </section>
  );
}
