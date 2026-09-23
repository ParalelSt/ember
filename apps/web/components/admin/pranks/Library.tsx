'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PauseIcon, PlayIcon } from '@/components/icons';
import { EmptyState } from '@/components/page/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiUrl } from '@/lib/api';
import { formatTime } from '@/lib/format';
import type { PrankSound } from '@/lib/pranks/types';

/** The sound library: upload (30 s and 5 MB at most), preview, rename,
 *  delete. Preview plays here, on the admin's own device. */
export function Library({
  sounds,
  loading,
  uploading,
  onUpload,
  onRename,
  onDelete,
}: {
  sounds: PrankSound[];
  loading: boolean;
  uploading: boolean;
  /** Resolves true when the upload landed, so the form can clear. */
  onUpload: (file: File, name: string) => Promise<boolean>;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audioRef.current?.pause(), []);

  const preview = (s: PrankSound) => {
    const a = (audioRef.current ??= new Audio());
    if (playing === s.id) {
      a.pause();
      setPlaying(null);
      return;
    }
    a.src = apiUrl(s.url);
    a.onended = () => setPlaying(null);
    void a.play().then(
      () => setPlaying(s.id),
      () => setPlaying(null),
    );
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    if (await onUpload(file, name.trim())) {
      setName('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const saveRename = (e: FormEvent) => {
    e.preventDefault();
    if (editing && editing.name.trim()) onRename(editing.id, editing.name.trim());
    setEditing(null);
  };

  return (
    <div className="flex flex-col gap-block">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-row text-sm" aria-label="Add to the library">
        <input ref={fileRef} type="file" accept="audio/mpeg,audio/mp4,.mp3,.m4a,audio/*" aria-label="Sound file" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" maxLength={120} className="w-48" />
        <Button type="submit" size="sm" disabled={uploading}>
          {uploading ? 'Uploading…' : 'Upload'}
        </Button>
        <span className="text-row-sub">30 s and 5 MB at most; mp3 or m4a play everywhere.</span>
      </form>

      {loading && <EmptyState>Loading…</EmptyState>}
      {!loading && sounds.length === 0 && <EmptyState>Nothing in the library yet.</EmptyState>}
      <ul className="flex flex-col gap-inset text-sm" aria-label="Library">
        {sounds.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-row">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={playing === s.id ? `Stop ${s.name}` : `Preview ${s.name}`}
              onClick={() => preview(s)}
            >
              {playing === s.id ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
            </Button>
            {editing?.id === s.id ? (
              <form onSubmit={saveRename} className="flex min-w-0 flex-1 items-center gap-cluster" aria-label={`Rename ${s.name}`}>
                <Input
                  autoFocus
                  value={editing.name}
                  maxLength={120}
                  aria-label="New name"
                  onChange={(e) => setEditing({ id: s.id, name: e.target.value })}
                />
                <Button type="submit" size="sm">Save</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="text-row-sub tabular-nums">{formatTime(s.durationSec)}</span>
                <Button size="sm" variant="ghost" aria-label={`Rename ${s.name}`} onClick={() => setEditing({ id: s.id, name: s.name })}>
                  Rename
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => onDelete(s.id)}>
                  Delete
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
