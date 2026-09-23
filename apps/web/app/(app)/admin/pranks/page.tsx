'use client';

import { useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/primitives/Avatar';
import { EmptyState } from '@/components/page/EmptyState';
import { SectionHeader } from '@/components/page/SectionHeader';
import {
  useExecuteDeletePrankSound,
  useExecuteSendPrank,
  useExecuteSetPranksEnabled,
  useExecuteUploadPrankSound,
  useQueryPrankLog,
  useQueryPrankPeople,
  useQueryPrankSettings,
  useQueryPrankSounds,
} from '@/hooks/useAdmin';
import { formatTime } from '@/lib/format';
import type { PrankPerson, PrankSoundKind } from '@/lib/pranks/types';
import { cn } from '@/lib/utils';

/** TEMPORARY admin pranks page: people with Ping and Sound buttons, the
 *  global switch, the library and the log. The real page replaces this
 *  once the owner picks a design on /dizajn (plan Task 8). */
export default function AdminPranksPage() {
  const { data: people = [], isLoading: peopleLoading } = useQueryPrankPeople();
  const { data: log, isLoading: logLoading } = useQueryPrankLog();
  const { data: settings } = useQueryPrankSettings();
  const send = useExecuteSendPrank();
  const setEnabled = useExecuteSetPranksEnabled();
  const { data: library = [], isLoading: libraryLoading } = useQueryPrankSounds();
  const upload = useExecuteUploadPrankSound();
  const remove = useExecuteDeletePrankSound();
  const enabled = settings?.enabled ?? log?.enabled ?? true;

  const sounds = library.filter((s) => s.kind === 'sound');
  const [soundId, setSoundId] = useState('');
  const [duck, setDuck] = useState(true);
  const picked = sounds.find((s) => s.id === soundId) ?? null;

  const ping = (p: PrankPerson) =>
    send.mutate({ targetId: p.id, kind: 'ping' }, {
      onSuccess: () => toast.success(`Ping sent to ${p.name}`),
      onError: (e) => toast.error((e as Error).message),
    });

  const playSound = (p: PrankPerson) => {
    if (!picked) return;
    send.mutate({ targetId: p.id, kind: 'sound', soundId: picked.id, params: { mode: duck ? 'duck' : 'over' } }, {
      onSuccess: () => toast.success(`“${picked.name}” sent to ${p.name}`),
      onError: (e) => toast.error((e as Error).message),
    });
  };

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadKind, setUploadKind] = useState<PrankSoundKind>('sound');
  const submitUpload = (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    upload.mutate({ file, kind: uploadKind, name: uploadName.trim() || undefined }, {
      onSuccess: (r) => {
        toast.success(`Added “${r.sound.name}”`);
        setUploadName('');
        if (fileRef.current) fileRef.current.value = '';
      },
      onError: (err) => toast.error((err as Error).message),
    });
  };

  const flip = () =>
    setEnabled.mutate(!enabled, {
      onSuccess: (r) =>
        toast.success(r.enabled ? 'Pranks are on' : `Pranks are off${r.cancelled ? `, ${r.cancelled} waiting cancelled` : ''}`),
      onError: (e) => toast.error(`Couldn't switch: ${(e as Error).message}`),
    });

  return (
    <section className="flex flex-col gap-section">
      <div className="rounded-lg border border-dashed px-row py-cluster text-sm text-muted-foreground">
        Temporary page: the real Pranks page comes after the /dizajn pick. Pings and sounds work so far.
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

      <div className="flex flex-wrap items-center gap-row text-sm">
        <label className="flex items-center gap-inset">
          Sound
          <select
            aria-label="Sound to play"
            value={soundId}
            onChange={(e) => setSoundId(e.target.value)}
            className="rounded-md border bg-card px-row py-inset"
          >
            <option value="">Pick a sound</option>
            {sounds.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-inset">
          <input type="checkbox" checked={duck} onChange={(e) => setDuck(e.target.checked)} />
          Turn their music down while it plays
        </label>
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
              <Button
                size="sm"
                variant="outline"
                disabled={!enabled || !picked || send.isPending}
                onClick={() => playSound(p)}
                aria-label={`Play the sound for ${p.name}`}
              >
                Sound
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <SectionHeader title="Library" className="mb-block" />
        <form onSubmit={submitUpload} className="mb-block flex flex-wrap items-center gap-row text-sm" aria-label="Add to the library">
          <input ref={fileRef} type="file" accept="audio/mpeg,audio/mp4,.mp3,.m4a,audio/*" aria-label="File" />
          <Input
            value={uploadName}
            onChange={(e) => setUploadName(e.target.value)}
            placeholder="Name (optional)"
            maxLength={120}
            className="w-48"
          />
          <select
            aria-label="Kind"
            value={uploadKind}
            onChange={(e) => setUploadKind(e.target.value as PrankSoundKind)}
            className="rounded-md border bg-card px-row py-inset"
          >
            <option value="sound">Sound (30 s, 5 MB at most)</option>
            <option value="song">Song for a swap (50 MB at most)</option>
          </select>
          <Button type="submit" size="sm" disabled={upload.isPending}>
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </Button>
          <span className="text-xs text-muted-foreground">mp3 or m4a play everywhere.</span>
        </form>
        {libraryLoading && <EmptyState>Loading…</EmptyState>}
        {!libraryLoading && library.length === 0 && <EmptyState>Nothing in the library yet.</EmptyState>}
        <ul className="flex flex-col gap-inset text-sm" aria-label="Library">
          {library.map((s) => (
            <li key={s.id} className="flex items-center gap-row">
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="text-muted-foreground">
                {s.kind === 'sound' ? 'Sound' : 'Song'}, {formatTime(s.durationSec)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={remove.isPending}
                aria-label={`Delete ${s.name}`}
                onClick={() =>
                  remove.mutate(s.id, {
                    onSuccess: () => {
                      if (soundId === s.id) setSoundId('');
                    },
                    onError: (e) => toast.error((e as Error).message),
                  })
                }
              >
                Delete
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
