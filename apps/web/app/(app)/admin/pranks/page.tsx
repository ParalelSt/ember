'use client';

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/primitives/Avatar';
import { EmptyState } from '@/components/page/EmptyState';
import { SectionHeader } from '@/components/page/SectionHeader';
import {
  useExecuteSendPrank,
  useExecuteSetPranksEnabled,
  useQueryPrankLog,
  useQueryPrankPeople,
  useQueryPrankSettings,
} from '@/hooks/useAdmin';
import type { PrankPerson } from '@/lib/pranks/types';
import { cn } from '@/lib/utils';

/** TEMPORARY admin pranks page: the delivery spine only (people, a Ping
 *  button, the global switch, the log). The real page replaces this once
 *  the owner picks a design on /dizajn (plan Task 8). */
export default function AdminPranksPage() {
  const { data: people = [], isLoading: peopleLoading } = useQueryPrankPeople();
  const { data: log, isLoading: logLoading } = useQueryPrankLog();
  const { data: settings } = useQueryPrankSettings();
  const send = useExecuteSendPrank();
  const setEnabled = useExecuteSetPranksEnabled();
  const enabled = settings?.enabled ?? log?.enabled ?? true;

  const ping = (p: PrankPerson) =>
    send.mutate(p.id, {
      onSuccess: () => toast.success(`Ping sent to ${p.name}`),
      onError: (e) => toast.error((e as Error).message),
    });

  const flip = () =>
    setEnabled.mutate(!enabled, {
      onSuccess: (r) =>
        toast.success(r.enabled ? 'Pranks are on' : `Pranks are off${r.cancelled ? `, ${r.cancelled} waiting cancelled` : ''}`),
      onError: (e) => toast.error(`Couldn't switch: ${(e as Error).message}`),
    });

  return (
    <section className="flex flex-col gap-section">
      <div className="rounded-lg border border-dashed px-row py-cluster text-sm text-muted-foreground">
        Temporary page: the real Pranks page comes after the /dizajn pick. Only pings work so far.
      </div>

      <div className="flex flex-wrap items-center justify-between gap-row">
        <SectionHeader title="Pranks" />
        <Button
          variant={enabled ? 'default' : 'outline'}
          aria-pressed={enabled}
          disabled={setEnabled.isPending || settings?.forcedOff}
          onClick={flip}
          title={settings?.forcedOff ? 'PRANKS_ENABLED=0 on the server' : undefined}
        >
          {enabled ? 'Pranks are on' : 'Pranks are off'}
        </Button>
      </div>

      <div>
        <SectionHeader title="People" className="mb-block" />
        {peopleLoading && <EmptyState>Loading…</EmptyState>}
        <ul className="flex flex-col gap-cluster" aria-label="People">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-row rounded-lg bg-card px-row py-cluster">
              <Avatar src={p.avatarUrl} name={p.name} className="size-8 bg-ember text-white text-xs" />
              <span
                aria-hidden
                className={cn('size-2 shrink-0 rounded-full', p.listening ? 'bg-green-500' : 'bg-muted-foreground/40')}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{p.name}</div>
                <div className="truncate text-xs text-muted-foreground" data-testid="presence-line">{p.line}</div>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!enabled || send.isPending}
                onClick={() => ping(p)}
                aria-label={`Ping ${p.name}`}
              >
                Ping
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <SectionHeader title="Log" className="mb-block" />
        {logLoading && <EmptyState>Loading…</EmptyState>}
        {!logLoading && (log?.pranks.length ?? 0) === 0 && <EmptyState>No pranks yet.</EmptyState>}
        <ol className="flex flex-col gap-inset text-sm" aria-label="Prank log">
          {log?.pranks.map((e) => (
            <li key={e.id} className="flex gap-row">
              <time className="shrink-0 tabular-nums text-muted-foreground" dateTime={e.created}>
                {new Date(e.created.replace(' ', 'T')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </time>
              <span data-status={e.status}>{e.line}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
