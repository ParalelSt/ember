'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertIcon, ChevronLeftIcon, HeartIcon, LinkIcon, QueueIcon, UploadIcon } from '@/components/icons';
import { LinkPreview } from '@/components/import/LinkPreview';
import { api } from '@/lib/api';
import { QK } from '@/hooks/useLibrary';
import { IMPORT_QK } from '@/hooks/useImports';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { logger } from '@/lib/logger/client';
import { parseImportUrl } from '@/lib/import/url';
import { OVER_CAP_MESSAGE, transferErrorMessage, ytmusicLikedErrorMessage } from '@/lib/import/transferCopy';
import {
  routesFor,
  serviceById,
  TRANSFER_SERVICES,
  type TransferRoute,
  type TransferServiceId,
} from '@/lib/import/transferRoutes';
import { YTMUSIC_HEADERS_NOTE } from '@/lib/import/sources/ytmusicLiked';
import type { JobKind, ImportSourceKind } from '@/lib/import/types';
import type { TransferPreview } from '@/app/api/import/upload/route';

/** Wait this long after typing stops before reading a pasted list or link. */
const LOOKUP_DELAY_MS = 400;

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
  | { step: 'link'; preview: LinkLookup }
  | { step: 'ytmusic'; preview: TransferPreview };

export interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the dialog was opened from, for the breadcrumb only. */
  from?: string;
}

/** Bring songs liked somewhere else into Ember, asked in plain words. Three
 *  questions, each a fact rather than a judgement: where the songs should
 *  land (two cards, because "these become your likes" is a consequence worth
 *  reading before anything is uploaded), where the music is now, and what
 *  the person already has in hand. Only the steps for that one combination
 *  show, so nobody reads about CSVs unless a file is their way in. Nothing
 *  starts until Ember has read the source and shown a preview of it. */
export function TransferDialog({ open, onOpenChange, from = 'settings' }: TransferDialogProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const isDesktop = useIsDesktop();
  const [destination, setDestination] = useState<JobKind | null>(null);
  const [serviceId, setServiceId] = useState<TransferServiceId | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  // The pasted YouTube Music request headers: a Google session, kept in
  // state only as long as the dialog needs it, never logged, never put in a
  // toast or an error string, and cleared the moment a transfer starts or
  // the dialog closes.
  const [secret, setSecret] = useState('');
  const [lookup, setLookup] = useState<Lookup>({ step: 'idle' });
  const [starting, setStarting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const asked = useRef('');

  const resetSource = useCallback(() => {
    setFile(null);
    setText('');
    setUrl('');
    setSecret('');
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
      setServiceId(null);
      setRouteId(null);
      setStarting(false);
      resetSource();
    } else {
      // Gone the moment the dialog closes, not just on the next open: those
      // headers are a Google session.
      setSecret('');
    }
  }
  useEffect(() => {
    if (!open) return;
    asked.current = '';
    if (fileInput.current) fileInput.current.value = '';
  }, [open]);

  const service = serviceId ? serviceById(serviceId) : null;
  // What this service can still offer for the chosen destination: the
  // YouTube Music account read always lands in the likes, so a new playlist
  // never sees it. One way in is no question at all, so it is taken as read.
  const choices = service && destination ? routesFor(service, destination) : [];
  const route: TransferRoute | null = choices.find((r) => r.id === routeId) ?? (choices.length === 1 ? choices[0] : null);
  // No phone browser has developer tools, so the account read is impossible
  // here. Said plainly, with the other way in offered rather than a shrug.
  const deadEnd = route !== null && route.desktopOnly === true && !isDesktop;

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

  // Unlike the other sources, this one is not read as the person types: the
  // route is rate limited to three reads an hour because each one spends a
  // signed-in Google session, so Preview is a deliberate click.
  const readYtmusic = useCallback(async () => {
    setLookup({ step: 'looking' });
    try {
      const { preview } = await api.ytmusicLikedPreview(secret);
      setLookup({ step: 'ytmusic', preview });
    } catch (e) {
      setLookup({ step: 'error', message: ytmusicLikedErrorMessage(e) });
    }
  }, [secret]);

  // A pasted list and a pasted link both read themselves once typing stops;
  // a chosen file is read at once.
  const kind = route?.kind ?? null;
  useEffect(() => {
    if (kind === 'paste') {
      const body = text.trim();
      if (!body || asked.current === `text:${body}`) return;
      const t = setTimeout(() => void readText(body), LOOKUP_DELAY_MS);
      return () => clearTimeout(t);
    }
    if (kind === 'link') {
      const link = url.trim();
      if (!link || asked.current === `link:${link}` || !parseImportUrl(link)) return;
      const t = setTimeout(() => void readLink(link), LOOKUP_DELAY_MS);
      return () => clearTimeout(t);
    }
  }, [kind, text, url, readText, readLink]);

  const chooseFile = (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0] ?? null;
    setFile(chosen);
    if (chosen) void readFile(chosen);
    else setLookup({ step: 'idle' });
  };

  const pickService = (id: TransferServiceId) => {
    setServiceId(id);
    setRouteId(null);
    clearSource();
  };

  const pickRoute = (id: string) => {
    setRouteId(id);
    clearSource();
  };

  /** One question back, whichever question that is. A service with a single
   *  way in never asked "what do you have", so its steps go straight back to
   *  the service cards. */
  const back = () => {
    clearSource();
    if (route && choices.length > 1) setRouteId(null);
    else if (service) setServiceId(null);
    else setDestination(null);
  };

  // Over the cap, the upload route refuses the start, so the dialog says so
  // here instead of letting someone press Start and be turned away. The
  // YouTube Music route is different: over the cap it still starts, just
  // with the newest songs kept, so it never sets overCap.
  const overCap = lookup.step === 'file' && lookup.preview.truncated;
  const count = lookup.step === 'file' || lookup.step === 'link' || lookup.step === 'ytmusic' ? lookup.preview.count : 0;
  const empty = (lookup.step === 'file' || lookup.step === 'link' || lookup.step === 'ytmusic') && count === 0 && !overCap;
  const ready = (lookup.step === 'file' || lookup.step === 'link' || lookup.step === 'ytmusic') && count > 0 && !overCap;

  const start = async () => {
    if (!ready || !destination || starting) return;
    setStarting(true);
    try {
      if (lookup.step === 'ytmusic') {
        const r = await api.ytmusicLikedStart(secret);
        setSecret('');
        logger.breadcrumb('import', 'transfer queued', { from, destination, source: r.job.source, total: r.job.total });
        void qc.invalidateQueries({ queryKey: IMPORT_QK.jobs });
        void qc.invalidateQueries({ queryKey: QK.likes });
        if (r.note) toast.info(r.note);
        onOpenChange(false);
        router.push('/library/liked');
        return;
      }
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
      setLookup({ step: 'error', message: lookup.step === 'ytmusic' ? ytmusicLikedErrorMessage(e) : transferErrorMessage(e) });
    } finally {
      setStarting(false);
    }
  };

  const title = !destination
    ? 'Transfer songs into Ember'
    : !service
      ? 'Where is your music now?'
      : !route
        ? 'What do you have already?'
        : service.heading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col" data-testid="transfer-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
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
          <div className="flex min-h-0 flex-col gap-block overflow-y-auto">
            <div className="flex items-center gap-cluster text-xs text-muted-foreground">
              <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={back}>
                <ChevronLeftIcon className="h-3.5 w-3.5" />
                Back
              </Button>
              <span data-testid="transfer-chosen-destination">
                Going to {destination === 'liked' ? 'your Liked songs' : 'a new playlist'}
                {service ? ` · ${service.name}` : ''}
              </span>
            </div>

            {!service && (
              <div className="grid gap-row md:grid-cols-2">
                {TRANSFER_SERVICES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    data-testid="transfer-service-card"
                    data-service={s.id}
                    onClick={() => pickService(s.id)}
                    className="rounded-lg border border-border bg-card p-block text-left text-sm font-semibold transition-colors hover:border-ember hover:bg-accent/60"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}

            {service && !route && (
              <div className="flex flex-col gap-cluster" data-testid="transfer-have-options">
                {choices.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    data-testid="transfer-have-option"
                    data-route={r.id}
                    onClick={() => pickRoute(r.id)}
                    className="rounded-lg border border-border p-row text-left text-sm font-medium transition-colors hover:border-ember hover:bg-accent/40"
                  >
                    {r.whatYouHave}
                  </button>
                ))}
              </div>
            )}

            {route && (
              <div className="flex flex-col gap-cluster" data-testid="transfer-steps">
                <ol className="flex flex-col gap-inset text-xs text-muted-foreground">
                  {route.steps.map((step, i) => (
                    <li key={i}>
                      {i + 1}. {step}
                    </li>
                  ))}
                </ol>
                {route.notes.map((note) => (
                  <p key={note} className="text-xs text-muted-foreground">
                    {note}
                  </p>
                ))}
              </div>
            )}

            {route && deadEnd && (
              <div data-testid="transfer-dead-end" className="flex flex-col gap-row rounded-lg border border-border bg-card p-row">
                <div className="flex items-center gap-cluster text-sm font-semibold">
                  <AlertIcon className="h-4 w-4 text-muted-foreground" />
                  This one needs a computer
                </div>
                <p className="text-xs text-muted-foreground">
                  Those steps need a desktop browser, and this looks like a phone. Come back to this on a computer, or
                  bring a playlist over instead.
                </p>
                {choices
                  .filter((r) => r.id !== route.id && !r.desktopOnly)
                  .map((r) => (
                    <Button key={r.id} type="button" variant="secondary" size="sm" onClick={() => pickRoute(r.id)} className="self-start">
                      {r.whatYouHave}
                    </Button>
                  ))}
              </div>
            )}

            {route && !deadEnd && route.kind === 'file' && (
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

            {route && !deadEnd && route.kind === 'paste' && (
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

            {route && !deadEnd && route.kind === 'link' && (
              <div className="relative">
                <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  aria-label="Playlist link"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={serviceId === 'ytmusic' ? 'Paste the YouTube Music playlist link' : 'Paste the Spotify playlist link'}
                  className="truncate pl-10"
                />
              </div>
            )}

            {route && !deadEnd && route.kind === 'ytmusic' && (
              <div className="flex flex-col gap-cluster">
                <textarea
                  aria-label="Your YouTube Music request headers"
                  data-testid="ytmusic-secret"
                  rows={4}
                  // A password field, not a text field: this is a Google
                  // session, so it never appears on screen as itself.
                  style={{ WebkitTextSecurity: 'disc' } as unknown as CSSProperties}
                  value={secret}
                  onChange={(e) => {
                    setSecret(e.target.value);
                    if (lookup.step === 'ytmusic' || lookup.step === 'error') setLookup({ step: 'idle' });
                  }}
                  placeholder="Paste the request headers here"
                  className="w-full resize-none rounded-lg border border-border bg-transparent px-row py-cluster text-sm"
                />
                <p className="text-xs text-muted-foreground">{YTMUSIC_HEADERS_NOTE}</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!secret.trim() || lookup.step === 'looking'}
                  onClick={() => void readYtmusic()}
                  className="self-start"
                >
                  {lookup.step === 'looking' ? 'Reading…' : 'Preview'}
                </Button>
              </div>
            )}

            {lookup.step === 'file' && <FilePreviewCard preview={lookup.preview} />}
            {lookup.step === 'ytmusic' && <FilePreviewCard preview={lookup.preview} />}
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
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {route && !deadEnd && (
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
