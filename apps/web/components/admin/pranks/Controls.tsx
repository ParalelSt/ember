'use client';

import { CheckIcon, ClockIcon, RepeatIcon, ShieldIcon, XCircleIcon } from '@/components/icons';
import { EmptyState } from '@/components/page/EmptyState';
import { Button } from '@/components/ui/button';
import type { PrankLogEntry, PrankSchedule } from '@/lib/pranks/types';
import { cn } from '@/lib/utils';

/** A PocketBase date ("2026-09-23 21:03:00.000Z") as the admin's own HH:MM. */
export function clock(pbDate: string): string {
  const d = new Date(pbDate.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The global off switch. Off also cancels whatever is waiting and stops
 *  every repeat (the route does that). */
export function SwitchRow({
  on,
  forcedOff,
  busy,
  onToggle,
}: {
  on: boolean;
  forcedOff: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-row rounded-lg border border-border px-row py-cluster">
      <div className="flex items-center gap-cluster">
        <ShieldIcon className="size-4 shrink-0" />
        <div>
          <div className="text-row-title">Pranks are {on ? 'on' : 'off'}</div>
          <div className="text-row-sub">
            {forcedOff
              ? 'Switched off on the server (PRANKS_ENABLED=0).'
              : on
                ? 'Every admin can send a sound to a friend.'
                : 'Nobody can be pranked right now.'}
          </div>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Pranks on or off"
        disabled={busy || forcedOff}
        onClick={onToggle}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          on ? 'bg-ember' : 'bg-muted',
        )}
      >
        <span className={cn('inline-block size-4 rounded-full bg-background transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />
      </button>
    </div>
  );
}

/** The repeats still running, each with its Stop. */
export function RepeatsList({
  schedules,
  stopping,
  onStop,
}: {
  schedules: PrankSchedule[];
  stopping: boolean;
  onStop: (id: string) => void;
}) {
  if (schedules.length === 0) return null;
  return (
    <ul className="flex flex-col gap-cluster" aria-label="Repeats running">
      {schedules.map((s) => (
        <li
          key={s.id}
          className="flex flex-wrap items-center justify-between gap-row rounded-lg border border-ember/40 bg-ember/10 px-row py-cluster"
        >
          <div className="flex items-center gap-cluster">
            <RepeatIcon className="size-4 shrink-0 text-ember" />
            <div>
              <div className="text-row-title">
                {s.line} until {clock(s.endsAt)}
              </div>
              <div className="text-row-sub">
                Played {s.fired} {s.fired === 1 ? 'time' : 'times'} so far, next at {clock(s.nextFireAt)}.
              </div>
            </div>
          </div>
          <Button size="sm" variant="outline" disabled={stopping} onClick={() => onStop(s.id)} aria-label={`Stop ${s.line}`}>
            Stop
          </Button>
        </li>
      ))}
    </ul>
  );
}

function statusIcon(status: PrankLogEntry['status']) {
  if (status === 'done' || status === 'delivered') return <CheckIcon className="size-3.5 shrink-0 text-ember" />;
  if (status === 'pending') return <ClockIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  return <XCircleIcon className="size-3.5 shrink-0 text-muted-foreground" />;
}

/** The log as a table: time, then the whole line in words. */
export function LogTable({ entries, loading }: { entries: PrankLogEntry[]; loading: boolean }) {
  if (loading) return <EmptyState>Loading…</EmptyState>;
  if (entries.length === 0) return <EmptyState>No pranks yet.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label="Prank log">
        <thead className="sr-only">
          <tr>
            <th scope="col">Time</th>
            <th scope="col">What happened</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} data-status={e.status} className="border-b border-border/50 last:border-0">
              <td className="whitespace-nowrap py-inset pr-row align-top tabular-nums text-muted-foreground">
                <time dateTime={e.created}>{clock(e.created)}</time>
              </td>
              <td className="py-inset align-top">
                <span className="flex items-start gap-cluster">
                  {statusIcon(e.status)}
                  <span>
                    {e.line}
                    {e.fromRepeat && <span className="text-row-sub"> (repeat)</span>}
                  </span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
