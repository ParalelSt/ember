'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Composer, type RepeatRequest, type SoundMode } from '@/components/admin/pranks/Composer';
import { clock, LogTable, RepeatsList, SwitchRow } from '@/components/admin/pranks/Controls';
import { Library } from '@/components/admin/pranks/Library';
import { PeopleList } from '@/components/admin/pranks/PeopleList';
import { SectionHeader } from '@/components/page/SectionHeader';
import { Button } from '@/components/ui/button';
import {
  useExecuteDeletePrankSound,
  useExecuteRenamePrankSound,
  useExecuteRepeatPrank,
  useExecuteSendPrank,
  useExecuteSetPranksEnabled,
  useExecuteStopAllPranks,
  useExecuteStopRepeat,
  useExecuteUploadPrankSound,
  useQueryPrankLog,
  useQueryPrankPeople,
  useQueryPrankSchedules,
  useQueryPrankSettings,
  useQueryPrankSounds,
} from '@/hooks/useAdmin';
import { intervalWords } from '@/lib/pranks/copy';

const fail = (what: string) => (e: unknown) => toast.error(`${what}: ${(e as Error).message}`);

/** Admin Pranks, the "Control room" the owner picked on /dizajn: people and
 *  what they play on the left, the composer on the right filling in as a
 *  person is picked, the log as a table below. Sounds only: a library sound
 *  over their music or with it turned down, once or on repeat. */
export default function AdminPranksPage() {
  const { data: people = [], isLoading: peopleLoading } = useQueryPrankPeople();
  const { data: log, isLoading: logLoading } = useQueryPrankLog();
  const { data: settings } = useQueryPrankSettings();
  const { data: library = [], isLoading: libraryLoading } = useQueryPrankSounds();
  const { data: schedules = [] } = useQueryPrankSchedules();
  const send = useExecuteSendPrank();
  const repeat = useExecuteRepeatPrank();
  const stopRepeat = useExecuteStopRepeat();
  const stopAll = useExecuteStopAllPranks();
  const setEnabled = useExecuteSetPranksEnabled();
  const upload = useExecuteUploadPrankSound();
  const rename = useExecuteRenamePrankSound();
  const remove = useExecuteDeletePrankSound();

  const enabled = settings?.enabled ?? log?.enabled ?? true;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const person = people.find((p) => p.id === selectedId) ?? null;
  const sounds = library.filter((s) => s.kind === 'sound');
  const theirRepeats = schedules.filter((s) => s.targetId === selectedId);

  const onSend = (soundId: string, mode: SoundMode) => {
    if (!person) return;
    const name = sounds.find((s) => s.id === soundId)?.name ?? 'The sound';
    send.mutate(
      { targetId: person.id, kind: 'sound', soundId, params: { mode } },
      { onSuccess: () => toast.success(`“${name}” sent to ${person.name}`), onError: (e) => toast.error((e as Error).message) },
    );
  };

  const onRepeat = (r: RepeatRequest) => {
    if (!person) return;
    repeat.mutate(
      { targetId: person.id, soundId: r.soundId, intervalSec: r.intervalSec, endsAt: r.endsAt.toISOString(), params: { mode: r.mode } },
      {
        onSuccess: ({ schedule }) =>
          toast.success(`Repeating “${schedule.soundName}” for ${person.name}, ${intervalWords(schedule.intervalSec)} until ${clock(schedule.endsAt)}`),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const stopOne = (id: string) =>
    stopRepeat.mutate(id, { onSuccess: () => toast.success('Repeat stopped'), onError: fail("Couldn't stop it") });

  const stopTheirs = () => theirRepeats.forEach((s) => stopOne(s.id));

  const onStopAll = () =>
    stopAll.mutate(undefined, {
      onSuccess: (r) =>
        toast.success(
          r.stopped || r.cancelled
            ? `Stopped ${r.stopped} ${r.stopped === 1 ? 'repeat' : 'repeats'}, cancelled ${r.cancelled} waiting`
            : 'Nothing was running',
        ),
      onError: fail("Couldn't stop everything"),
    });

  const flip = () =>
    setEnabled.mutate(!enabled, {
      onSuccess: (r) =>
        toast.success(r.enabled ? 'Pranks are on' : `Pranks are off${r.cancelled ? `, ${r.cancelled} waiting cancelled` : ''}`),
      onError: fail("Couldn't switch"),
    });

  const onUpload = (file: File, name: string) =>
    new Promise<boolean>((resolve) =>
      upload.mutate(
        { file, kind: 'sound', name: name || undefined },
        {
          onSuccess: (r) => {
            toast.success(`Added “${r.sound.name}”`);
            resolve(true);
          },
          onError: (e) => {
            toast.error((e as Error).message);
            resolve(false);
          },
        },
      ),
    );

  return (
    <section className="flex flex-col gap-section">
      <div className="flex flex-col gap-stack">
        <SectionHeader
          title="Pranks"
          action={
            <Button variant="outline" size="sm" onClick={onStopAll} disabled={stopAll.isPending}>
              Stop everything
            </Button>
          }
        />
        <SwitchRow on={enabled} forcedOff={settings?.forcedOff ?? false} busy={setEnabled.isPending} onToggle={flip} />
        <RepeatsList schedules={schedules} stopping={stopRepeat.isPending} onStop={stopOne} />
      </div>

      <div className="flex flex-col gap-stack md:flex-row md:items-start">
        <div className="flex w-full flex-col gap-block md:w-72 md:shrink-0">
          <SectionHeader title="People" />
          <PeopleList people={people} loading={peopleLoading} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-block">
          <SectionHeader title="Compose" />
          <Composer
            person={person}
            sounds={sounds}
            disabled={!enabled}
            busy={send.isPending || repeat.isPending}
            repeatsRunning={theirRepeats.length}
            onSend={onSend}
            onRepeat={onRepeat}
            onStopRepeats={stopTheirs}
          />
        </div>
      </div>

      <div className="flex flex-col gap-block">
        <SectionHeader title="Sound library" />
        <Library
          sounds={sounds}
          loading={libraryLoading}
          uploading={upload.isPending}
          onUpload={onUpload}
          onRename={(id, name) => rename.mutate({ id, name }, { onError: fail("Couldn't rename it") })}
          onDelete={(id) => remove.mutate(id, { onError: (e) => toast.error((e as Error).message) })}
        />
      </div>

      <div className="flex flex-col gap-block">
        <SectionHeader title="Log" />
        <LogTable entries={log?.pranks ?? []} loading={logLoading} />
      </div>
    </section>
  );
}
