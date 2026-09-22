'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronLeftIcon, HeartIcon, LinkIcon, QueueIcon, UploadIcon } from '@/components/icons';
import { LinkPreview } from '@/components/import/LinkPreview';
import { api } from '@/lib/api';
import { QK } from '@/hooks/useLibrary';
import { IMPORT_QK } from '@/hooks/useImports';
import { logger } from '@/lib/logger/client';
import { parseImportUrl } from '@/lib/import/url';
import { OVER_CAP_MESSAGE, transferErrorMessage } from '@/lib/import/transferCopy';
import type { JobKind, ImportSourceKind } from '@/lib/import/types';
import type { TransferPreview } from '@/app/api/import/upload/route';
import { cn } from '@/lib/utils';

/** Wait this long after typing stops before reading a pasted list or link. */
const LOOKUP_DELAY_MS = 400;

type SourceTab = 'file' | 'paste' | 'link';

const DESTINATIONS: { id: JobKind; name: string; consequence: string; icon: typeof HeartIcon }[] = [
  {
    id: 'liked',
    name: 'Liked songs',
    consequence: 'These become your likes and shape your mixes and radio.',
    icon: HeartIcon,
  },
  {
    id: 'playlist',
    name: 'A new playlist',
    consequence: 'A playlist you can edit, reorder and share.',
    icon: QueueIcon,
  },
];

const TABS: { id: SourceTab; label: string; help: string }[] = [
  {
    id: 'file',
    label: 'Upload a file',
    help:
      'Your Spotify data export (Account, then Privacy settings, then Download your data): upload the YourLibrary.json inside it, unzipped. A CSV from Exportify, Soundiiz, TuneMyMusic or Apple’s export works as it is.',
  },
  {
    id: 'paste',
    label: 'Paste a list',
    help: 'One song a line, written "Artist - Title". Numbering and lengths at the end of a line are ignored.',
  },
  {
    id: 'link',
    label: 'Paste a link',
    help:
      'A public Spotify playlist link, or a YouTube Music playlist link. Spotify cannot share Liked Songs, so copy them into a public playlist first.',
  },
];

/** A link Ember looked up, flattened so both kinds of source render the
 *  same preview card. */
interface LinkLookup {
  url: string;
  kind: ImportSourceKind;
  name: string;
  coverUrl: string | null;
  count: number;
  truncated: boolean;
}

type Lookup =
  | { step: 'idle' }
  | { step: 'looking' }
  | { step: 'error'; message: string }
  | { step: 'file'; preview: TransferPreview }
  | { step: 'link'; preview: LinkLookup };

export interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the dialog was opened from, for the breadcrumb only. */
  from?: string;
}

/** Bring songs liked somewhere else into Ember. Two steps: where they land
 *  (two cards, because "these become your likes" is a consequence worth
 *  reading before anything is uploaded), then where they come from (a file,
 *  a pasted list, or a playlist link) with a preview of what Ember read.
 *  Nothing starts until that preview is on screen. */
export function TransferDialog({ open, onOpenChange, from = 'settings' }: TransferDialogProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const [destination, setDestination] = useState<JobKind | null>(null);
  const [tab, setTab] = useState<SourceTab>('file');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [lookup, setLookup] = useState<Lookup>({ step: 'idle' });
  const [starting, setStarting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const asked = useRef('');

  const resetSource = useCallback(() => {
    setFile(null);
    setText('');
    setUrl('');
    setLookup({ step: 'idle' });
  }, []);

  /** Forget the source AND what was last asked about, so choosing the same
   *  file again reads it again. Event handlers only: it touches refs. */
  const clearSource = useCallback(() => {
    asked.current = '';
    if (fileInput.current) fileInput.current.value = '';
    resetSource();
  }, [resetSource]);

  // Reset on every fresh open, during render rather than in an effect, so
  // the last run's file or preview never paints. The refs go with it, but
  // they render nothing, so they can wait for the effect below.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDestination(null);
      setTab('file');
      setStarting(false);
      resetSource();
    }
  }
  useEffect(() => {
    if (!open) return;
    asked.current = '';
    if (fileInput.current) fileInput.current.value = '';
  }, [open]);

  const readFile = useCallback(async (chosen: File) => {
    const token = `file:${chosen.name}:${chosen.size}:${chosen.lastModified}`;
    asked.current = token;
    setLookup({ step: 'looking' });
    try {
      const { preview } = await api.transferPreview({ file: chosen });
      if (asked.current === token) setLookup({ step: 'file', preview });
    } catch (e) {
      if (asked.current === token) setLookup({ step: 'error', message: transferErrorMessage(e) });
    }
  }, []);

  const readText = useCallback(async (pasted: string) => {
    const token = `text:${pasted}`;
    asked.current = token;
    setLookup({ step: 'looking' });
    try {
      const { preview } = await api.transferPreview({ text: pasted });
      if (asked.current === token) setLookup({ step: 'file', preview });
    } catch (e) {
      if (asked.current === token) setLookup({ step: 'error', message: transferErrorMessage(e) });
    }
  }, []);

  const readLink = useCallback(async (link: string) => {
    const token = `link:${link}`;
    asked.current = token;
    setLookup({ step: 'looking' });
    try {
      const r = await api.importInspect(link);
      if (asked.current !== token) return;
      setLookup({
        step: 'link',
        preview:
          r.source === 'spotify'
            ? { url: link, kind: 'spotify', name: r.name, coverUrl: r.coverUrl, count: r.items.length, truncated: r.truncated }
            : {
                url: link,
                kind: /music\.youtube\.com/i.test(link) ? 'ytmusic' : 'youtube',
                name: r.name,
                coverUrl: r.tracks[0]?.artworkUrl ?? null,
                count: r.tracks.length,
                truncated: false,
              },
      });
    } catch (e) {
      // Server messages here are written for people (private, not found,
      // Spotify unreachable): show them as they are.
      if (asked.current === token) setLookup({ step: 'error', message: transferErrorMessage(e) });
    }
  }, []);

  // A pasted list and a pasted link both read themselves once typing stops;
  // a chosen file is read at once.
  useEffect(() => {
    if (tab === 'paste') {
      const body = text.trim();
      if (!body || asked.current === `text:${body}`) return;
      const t = setTimeout(() => void readText(body), LOOKUP_DELAY_MS);
      return () => clearTimeout(t);
    }
    if (tab === 'link') {
      const link = url.trim();
      if (!link || asked.current === `link:${link}` || !parseImportUrl(link)) return;
      const t = setTimeout(() => void readLink(link), LOOKUP_DELAY_MS);
      return () => clearTimeout(t);
    }
  }, [tab, text, url, readText, readLink]);

  const chooseFile = (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0] ?? null;
    setFile(chosen);
    if (chosen) void readFile(chosen);
    else setLookup({ step: 'idle' });
  };

  const switchTab = (next: SourceTab) => {
    setTab(next);
    clearSource();
  };

  // Over the cap, the upload route refuses the start, so the dialog says so
  // here instead of letting someone press Start and be turned away.
  const overCap = lookup.step === 'file' && lookup.preview.truncated;
  const count = lookup.step === 'file' || lookup.step === 'link' ? lookup.preview.count : 0;
  const empty = (lookup.step === 'file' || lookup.step === 'link') && count === 0 && !overCap;
  const ready = (lookup.step === 'file' || lookup.step === 'link') && count > 0 && !overCap;

  const start = async () => {
    if (!ready || !destination || starting) return;
    setStarting(true);
    try {
      const r =
        lookup.step === 'link'
          ? await api.importStart(lookup.preview.url, destination)
          : await api.transferStart(file ? { file, destination } : { text: text.trim(), destination });
      logger.breadcrumb('import', 'transfer queued', { from, destination, source: r.job.source, total: r.job.total });
      void qc.invalidateQueries({ queryKey: IMPORT_QK.jobs });
      void qc.invalidateQueries({ queryKey: QK.playlists });
      void qc.invalidateQueries({ queryKey: QK.likes });
      onOpenChange(false);
      router.push(r.playlistId ? `/playlist/${r.playlistId}` : '/library/liked');
    } catch (e) {
      setLookup({ step: 'error', message: transferErrorMessage(e) });
    } finally {
      setStarting(false);
    }
  };

  const help = TABS.find((t) => t.id === tab)!.help;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col" data-testid="transfer-dialog">
        <DialogHeader>
          <DialogTitle>{destination ? 'Where are they now?' : 'Transfer songs into Ember'}</DialogTitle>
        </DialogHeader>

        {!destination ? (
          <div className="flex min-h-0 flex-col gap-block">
            <p className="text-sm text-muted-foreground">Where should the songs land?</p>
            <div className="grid gap-row md:grid-cols-2">
              {DESTINATIONS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  data-testid="transfer-destination-card"
                  data-destination={d.id}
                  onClick={() => setDestination(d.id)}
                  className="flex flex-col gap-cluster rounded-lg border border-border bg-card p-block text-left transition-colors hover:border-ember hover:bg-accent/60"
                >
                  <d.icon className="h-5 w-5 text-ember" />
                  <span className="text-sm font-semibold">{d.name}</span>
                  <span className="text-xs text-muted-foreground">{d.consequence}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-block">
            <div className="flex items-center gap-cluster text-xs text-muted-foreground">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => {
                  setDestination(null);
                  clearSource();
                }}
              >
                <ChevronLeftIcon className="h-3.5 w-3.5" />
                Back
              </Button>
              <span data-testid="transfer-chosen-destination">
                Going to {destination === 'liked' ? 'your Liked songs' : 'a new playlist'}
              </span>
            </div>

            <div role="tablist" aria-label="Where the songs come from" className="flex gap-stack border-b border-border">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => switchTab(t.id)}
                  className={cn(
                    '-mb-px flex items-center gap-cluster border-b-2 pb-cluster text-sm font-medium transition-colors',
                    tab === t.id ? 'border-ember text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'file' && (
              <div className="flex flex-col gap-cluster">
                <input
                  ref={fileInput}
                  type="file"
                  accept=".json,.csv,.tsv,.txt,application/json,text/csv,text/plain"
                  aria-label="Song list file"
                  className="hidden"
                  onChange={chooseFile}
                />
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="flex flex-col items-center gap-cluster rounded-lg border border-dashed border-border py-block text-center transition-colors hover:border-ember hover:bg-accent/40"
                >
                  <UploadIcon className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm">{file ? file.name : 'Choose a file'}</span>
                  <span className="text-xs text-muted-foreground">YourLibrary.json, or a .csv</span>
                </button>
              </div>
            )}

            {tab === 'paste' && (
              <textarea
                autoFocus
                aria-label="Your songs, one a line"
                rows={6}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={'Halcyon Drift - Paper Lanterns\nNadia Okonkwo - Slow Weather'}
                className="w-full resize-none rounded-lg border border-border bg-transparent px-row py-cluster text-sm"
              />
            )}

            {tab === 'link' && (
              <div className="relative">
                <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  aria-label="Playlist link"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste a Spotify or YouTube Music playlist link"
                  className="truncate pl-10"
                />
              </div>
            )}

            {lookup.step === 'file' && <FilePreviewCard preview={lookup.preview} />}
            {lookup.step === 'link' && (
              <LinkPreview
                kind={lookup.preview.kind}
                name={lookup.preview.name}
                coverUrl={lookup.preview.coverUrl}
                count={lookup.preview.count}
                truncated={lookup.preview.truncated}
              />
            )}
            {overCap && (
              <p role="alert" data-testid="transfer-over-cap" className="text-xs text-destructive">
                {OVER_CAP_MESSAGE}
              </p>
            )}
            {empty && (
              <p role="alert" data-testid="transfer-empty" className="text-xs text-destructive">
                There are no songs in that.
              </p>
            )}
            {lookup.step === 'looking' && <p className="text-xs text-muted-foreground">Reading it…</p>}
            {lookup.step === 'error' && (
              <p role="alert" data-testid="transfer-error" className="text-xs text-destructive">
                {lookup.message}
              </p>
            )}
            {lookup.step === 'idle' && <p className="text-xs text-muted-foreground">{help}</p>}
            <p className="text-xs text-muted-foreground/70">
              Bringing your YouTube Music likes straight across, without a file, is coming later.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {destination && (
            <Button
              type="button"
              disabled={!ready || starting}
              onClick={() => void start()}
              className="bg-ember text-white hover:bg-ember-soft"
            >
              {starting ? 'Starting…' : ready ? `Transfer ${count} songs` : 'Transfer'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What Ember read out of the file or the pasted list, before anything is
 *  started: how many songs, where they came from, and the first few by name
 *  so an obviously wrong file is obvious. */
function FilePreviewCard({ preview }: { preview: TransferPreview }) {
  return (
    <div data-testid="transfer-preview" className="rounded-lg border border-border bg-card p-row">
      <div className="text-sm font-semibold">{preview.label}</div>
      <div className="text-xs text-muted-foreground">
        {preview.count} {preview.count === 1 ? 'song' : 'songs'}
        {preview.dropped > 0 ? `, ${preview.dropped} ${preview.dropped === 1 ? 'row' : 'rows'} Ember could not read` : ''}
      </div>
      {preview.sample.length > 0 && (
        <ul className="mt-cluster flex flex-col gap-inset text-xs text-muted-foreground">
          {preview.sample.map((s, i) => (
            <li key={`${s.title}-${i}`} className="truncate">
              <span className="text-foreground">{s.title}</span>
              {s.artist ? `, ${s.artist}` : ''}
            </li>
          ))}
          {preview.count > preview.sample.length && <li>and {preview.count - preview.sample.length} more</li>}
        </ul>
      )}
    </div>
  );
}
