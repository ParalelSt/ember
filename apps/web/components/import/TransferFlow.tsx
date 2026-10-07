'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, HeartIcon, KeyIcon, LinkIcon, QueueIcon, UploadIcon } from '@/components/icons';
import { LinkPreview } from '@/components/import/LinkPreview';
import { HaveOptions, StepCard } from '@/components/import/TransferSteps';
import { api } from '@/lib/api';
import { QK } from '@/hooks/useLibrary';
import { IMPORT_QK } from '@/hooks/useImports';
import { logger } from '@/lib/logger/client';
import { parseImportUrl } from '@/lib/import/url';
import {
  googleLikesErrorMessage,
  KEPT_FIRST_MESSAGE,
  OVER_CAP_MESSAGE,
  transferErrorMessage,
  transferEstimate,
} from '@/lib/import/transferCopy';
import {
  LIKED_SERVICES_OPEN,
  routesFor,
  serviceById,
  serviceOpen,
  TRANSFER_SERVICES,
  type TransferRoute,
  type TransferService,
  type TransferServiceId,
} from '@/lib/import/transferRoutes';
import {
  checkingLine,
  GOOGLE_FALLBACK_HINT,
  GOOGLE_MESSAGES,
  GOOGLE_UNVERIFIED_HINT,
  toCheckLine,
} from '@/lib/import/sources/ytmusicLiked';
import type { JobKind, ImportSourceKind } from '@/lib/import/types';
import type { TransferPreview } from '@/app/api/import/upload/route';
import type { CheckProgress, GooglePreview } from '@/lib/import/google/flows';
import { cn } from '@/lib/utils';

/** Wait this long after typing stops before reading a pasted list or link. */
const LOOKUP_DELAY_MS = 400;

/** How often the dialog asks the server how a Google sign-in stands. The
 *  server does the polling of Google itself. */
export const GOOGLE_POLL_MS = 2_000;

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
  | { step: 'google'; preview: GooglePreview; flowId: string };

/** A Google sign-in before its likes are read: asking for a code, then
 *  showing it while the person allows Ember on Google's page. */
type SignIn =
  | { step: 'idle' }
  | { step: 'asking' }
  | {
      step: 'code';
      flowId: string;
      userCode: string;
      verificationUrl: string;
      reading: boolean;
      /** Set once YouTube Music is checking which likes are songs. */
      checking: CheckProgress | null;
    }
  | { step: 'failed'; message: string };

export interface TransferFlowProps {
  /** Where the songs go until the person picks the other card. */
  initialDestination?: JobKind;
  /** The page the flow was opened from: Back on the first screen returns
   *  there. Only an app path is accepted. */
  from?: string;
  /** Services that may fill the Liked songs; the rest show crossed out.
   *  Defaults to every service (`LIKED_SERVICES_OPEN`). */
  likedServicesOpen?: readonly TransferServiceId[];
}

/** An app path to go back to, or the Liked songs page. A full URL or a
 *  protocol-relative one is never followed. */
export function safeFrom(from: string | undefined | null): string {
  return from && from.startsWith('/') && !from.startsWith('//') ? from : '/library/liked';
}

/** Bring songs liked somewhere else into Ember, on one page. The first
 *  screen asks both questions a transfer starts with at once: where the
 *  songs should go (two cards, because "these become your likes" is a
 *  consequence worth reading before anything is uploaded) and where they
 *  are now (the four services as rows, each saying what it needs; nothing
 *  crossed out). Then only the way in the person has in hand, and nothing
 *  starts until Ember has read the source and shown a preview of it. */
export function TransferFlow({
  initialDestination = 'liked',
  from: fromParam,
  likedServicesOpen = LIKED_SERVICES_OPEN,
}: TransferFlowProps) {
  const from = safeFrom(fromParam);
  const router = useRouter();
  const qc = useQueryClient();
  const [destination, setDestination] = useState<JobKind>(initialDestination);
  const [serviceId, setServiceId] = useState<TransferServiceId | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  // Which of the way in's steps is showing, one at a time.
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  // A Google sign-in in flight. The dialog only ever holds its id and the
  // code the person types: the tokens stay on the server, which forgets
  // them once the likes are read.
  const [signIn, setSignIn] = useState<SignIn>({ step: 'idle' });
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null);
  const flowRef = useRef<string | null>(null);
  // Bumped by every new sign-in and every cancel, so a code that arrives
  // after the person moved on is cancelled rather than shown.
  const attempt = useRef(0);
  const [lookup, setLookup] = useState<Lookup>({ step: 'idle' });
  const [starting, setStarting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const asked = useRef('');

  const resetSource = useCallback(() => {
    setFile(null);
    setText('');
    setUrl('');
    setSignIn({ step: 'idle' });
    setLookup({ step: 'idle' });
  }, []);

  /** Tell the server to revoke and forget the sign-in in flight, if any.
   *  Fire and forget: the server's own 15 minutes end it regardless. */
  const cancelSignIn = useCallback(() => {
    attempt.current++;
    const flowId = flowRef.current;
    flowRef.current = null;
    if (flowId) void api.googleLikesCancel(flowId).catch(() => {});
  }, []);

  /** Forget the source AND what was last asked about, so choosing the same
   *  file again reads it again. Event handlers only: it touches refs. */
  const clearSource = useCallback(() => {
    asked.current = '';
    if (fileInput.current) fileInput.current.value = '';
    cancelSignIn();
    resetSource();
  }, [resetSource, cancelSignIn]);

  // Leaving the page cancels a sign-in that never reached Start, so the
  // server revokes it now rather than at its timeout.
  useEffect(() => cancelSignIn, [cancelSignIn]);

  const service = serviceId ? serviceById(serviceId) : null;
  // What this service can still offer for the chosen destination: the
  // Google sign-in always lands in the likes, so a new playlist never sees
  // it. One way in is no question at all, so it is taken as read.
  const choices = service ? routesFor(service, destination) : [];
  const route: TransferRoute | null = choices.find((r) => r.id === routeId) ?? (choices.length === 1 ? choices[0] : null);
  // A server with no Google client says so, and offers the way in that
  // needs no sign-in, rather than a button that can only fail.
  const notSetUp = route?.kind === 'google' && googleConfigured === false;

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

  const beginSignIn = async () => {
    cancelSignIn();
    const mine = attempt.current;
    setLookup({ step: 'idle' });
    setSignIn({ step: 'asking' });
    try {
      const r = await api.googleLikesBegin();
      if (attempt.current !== mine) {
        void api.googleLikesCancel(r.flowId).catch(() => {});
        return;
      }
      flowRef.current = r.flowId;
      setSignIn({
        step: 'code',
        flowId: r.flowId,
        userCode: r.userCode,
        verificationUrl: r.verificationUrl,
        reading: false,
        checking: null,
      });
    } catch (e) {
      if (attempt.current !== mine) return;
      const message = googleLikesErrorMessage(e);
      if (message === GOOGLE_MESSAGES.notConfigured) setGoogleConfigured(false);
      setSignIn({ step: 'failed', message });
    }
  };

  // Whether this server can do a Google sign-in at all, asked once the
  // sign-in is the way in, so an unconfigured server says so up front.
  const routeKind = route?.kind ?? null;
  useEffect(() => {
    if (routeKind !== 'google' || googleConfigured !== null) return;
    let live = true;
    api
      .googleLikesConfig()
      .then((r) => live && setGoogleConfigured(r.configured))
      // Unknown is not "no": the button still works and says why if not.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [routeKind, googleConfigured]);

  // While the code is up, ask the server how it stands. The server is the
  // one polling Google, at the interval Google gives.
  const waitingOn = signIn.step === 'code' ? signIn.flowId : null;
  useEffect(() => {
    if (!waitingOn) return;
    let live = true;
    const tick = async () => {
      try {
        const r = await api.googleLikesStatus(waitingOn);
        if (!live || flowRef.current !== waitingOn) return;
        if (r.state === 'ready' && r.preview) {
          setSignIn({ step: 'idle' });
          setLookup({ step: 'google', preview: r.preview, flowId: waitingOn });
        } else if (r.state === 'waiting' || r.state === 'reading') {
          setSignIn((s) =>
            s.step === 'code' && s.flowId === waitingOn ? { ...s, reading: r.state === 'reading', checking: r.checking ?? null } : s,
          );
        } else {
          // Over, one way or another: the server has already forgotten it.
          flowRef.current = null;
          setSignIn({ step: 'failed', message: r.message ?? GOOGLE_MESSAGES.readFailed });
        }
      } catch (e) {
        if (!live || flowRef.current !== waitingOn) return;
        flowRef.current = null;
        setSignIn({ step: 'failed', message: googleLikesErrorMessage(e) });
      }
    };
    const t = setInterval(() => void tick(), GOOGLE_POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [waitingOn]);

  // A pasted list and a pasted link both read themselves once typing stops;
  // a chosen file is read at once.
  const kind = routeKind;
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

  /** The pasted list or link changed: a preview (or a look-up still on its
   *  way) for what was there before is not this text's, so it goes, and
   *  Start waits for the new one. Start used to import the previewed
   *  playlist, not the link now in the box. */
  const editSource = (token: string) => {
    if (asked.current === token) return;
    asked.current = '';
    if (lookup.step !== 'idle') setLookup({ step: 'idle' });
  };

  const chooseFile = (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0] ?? null;
    setFile(chosen);
    if (chosen) void readFile(chosen);
    else setLookup({ step: 'idle' });
  };

  const pickService = (id: TransferServiceId) => {
    setServiceId(id);
    setRouteId(null);
    setStep(0);
    clearSource();
  };

  const pickRoute = (id: string) => {
    setRouteId(id);
    setStep(0);
    clearSource();
  };

  /** One question back, whichever question that is. A service with a single
   *  way in never asked "what do you have", so its steps go straight back to
   *  the service cards. */
  const back = () => {
    clearSource();
    setStep(0);
    if (route && choices.length > 1) setRouteId(null);
    else if (service) setServiceId(null);
    else router.push(from);
  };

  const pickDestination = (d: JobKind) => {
    setDestination(d);
    // The Google sign-in is for Liked songs only: a way in that is no longer
    // on offer goes, and the person picks again.
    if (route?.likedOnly && d !== 'liked') {
      setRouteId(null);
      clearSource();
    }
  };

  // Over the cap, the upload route refuses the start, so the dialog says so
  // here instead of letting someone press Start and be turned away. The
  // Google sign-in is different: over the cap it still starts, just with
  // the newest songs kept, so it never sets overCap.
  // A YourLibrary.json is the exception: it starts with the first 10 000.
  const keptFirst = lookup.step === 'file' && lookup.preview.truncated && lookup.preview.kind === 'spotify-export';
  const overCap = lookup.step === 'file' && lookup.preview.truncated && !keptFirst;
  const previewed = lookup.step === 'file' || lookup.step === 'link' || lookup.step === 'google';
  // A Google preview counts songs and the uploads to check separately; both
  // come across, so the button counts both.
  const count = !previewed ? 0 : lookup.step === 'google' ? lookup.preview.count + lookup.preview.toCheck : lookup.preview.count;
  const empty = previewed && count === 0 && !overCap;
  const ready = previewed && count > 0 && !overCap;

  const start = async () => {
    if (!ready || starting) return;
    setStarting(true);
    try {
      if (lookup.step === 'google') {
        const r = await api.googleLikesStart(lookup.flowId);
        // Started: the server has already dropped the sign-in.
        flowRef.current = null;
        logger.breadcrumb('import', 'transfer queued', { from, destination, source: r.job.source, total: r.job.total });
        void qc.invalidateQueries({ queryKey: IMPORT_QK.jobs });
        void qc.invalidateQueries({ queryKey: QK.likes });
        if (r.note) toast.info(r.note);
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
      router.push(r.playlistId ? `/playlist/${r.playlistId}` : '/library/liked');
    } catch (e) {
      if (lookup.step === 'google') {
        flowRef.current = null;
        setLookup({ step: 'idle' });
        setSignIn({ step: 'failed', message: googleLikesErrorMessage(e) });
      } else {
        setLookup({ step: 'error', message: transferErrorMessage(e) });
      }
    } finally {
      setStarting(false);
    }
  };

  const title = !service ? 'Transfer songs into Ember' : !route ? 'What do you have already?' : service.heading;

  return (
    <div data-testid="transfer-page" className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-block">
      <div className="sticky top-[var(--ember-topbar-h,0px)] z-10 -mx-cluster flex items-center gap-cluster bg-background px-cluster py-cluster">
        <Button type="button" variant="ghost" size="icon" aria-label="Go back" onClick={back}>
          <ChevronLeftIcon className="h-5 w-5" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight">{title}</h1>
      </div>

      {!service ? (
        <Chooser
          destination={destination}
          onDestination={pickDestination}
          likedServicesOpen={likedServicesOpen}
          onService={pickService}
        />
      ) : (
        <div className="flex min-h-0 flex-col gap-block">
          {!route && <HaveOptions choices={choices} onPick={pickRoute} />}

          {notSetUp && (
            <div data-testid="google-not-set-up" className="flex flex-col gap-row rounded-lg border border-border bg-card p-row">
              <div className="flex items-center gap-cluster text-sm font-semibold">
                <AlertIcon className="h-4 w-4 text-muted-foreground" />
                {GOOGLE_MESSAGES.notConfigured}
              </div>
              <p className="text-xs text-muted-foreground">{GOOGLE_FALLBACK_HINT}</p>
              {choices
                .filter((r) => r.kind === 'link')
                .map((r) => (
                  <Button key={r.id} type="button" variant="secondary" size="sm" onClick={() => pickRoute(r.id)} className="self-start">
                    {r.whatYouHave}
                  </Button>
                ))}
            </div>
          )}

          {route && !notSetUp && (
            <StepCard
              route={route}
              step={step}
              onStep={setStep}
              control={
                <div className="flex flex-col gap-cluster">
                  {route.kind === 'file' && (
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

                  {route.kind === 'paste' && (
                    <textarea
                      autoFocus
                      aria-label="Your songs, one a line"
                      rows={6}
                      value={text}
                      onChange={(e) => {
                        setText(e.target.value);
                        editSource(`text:${e.target.value.trim()}`);
                      }}
                      placeholder={'Halcyon Drift - Paper Lanterns\nNadia Okonkwo - Slow Weather'}
                      className="w-full resize-none rounded-lg border border-border bg-transparent px-row py-cluster text-sm"
                    />
                  )}

                  {route.kind === 'link' && (
                    <div className="relative">
                      <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        autoFocus
                        aria-label="Playlist link"
                        value={url}
                        onChange={(e) => {
                          setUrl(e.target.value);
                          editSource(`link:${e.target.value.trim()}`);
                        }}
                        placeholder={serviceId === 'ytmusic' ? 'Paste the YouTube Music playlist link' : 'Paste the Spotify playlist link'}
                        className="truncate pl-10"
                      />
                    </div>
                  )}

                  {route.kind === 'google' && lookup.step !== 'google' && (
                    <GoogleSignInPanel signIn={signIn} onSignIn={() => void beginSignIn()} />
                  )}
                </div>
              }
            />
          )}

          {lookup.step === 'file' && <FilePreviewCard preview={lookup.preview} />}
          {lookup.step === 'google' && (
            <>
              <FilePreviewCard preview={lookup.preview} />
              {lookup.preview.toCheck > 0 && (
                <p data-testid="google-to-check" className="text-xs text-muted-foreground">
                  {toCheckLine(lookup.preview.toCheck)}
                </p>
              )}
            </>
          )}
          {lookup.step === 'link' && (
            <LinkPreview
              kind={lookup.preview.kind}
              name={lookup.preview.name}
              coverUrl={lookup.preview.coverUrl}
              count={lookup.preview.count}
              truncated={lookup.preview.truncated}
            />
          )}
          {keptFirst && (
            <p data-testid="transfer-kept-first" className="text-xs text-muted-foreground">
              {KEPT_FIRST_MESSAGE}
            </p>
          )}
          {ready && lookup.step !== 'google' && (
            <p data-testid="transfer-estimate" className="text-xs text-muted-foreground">
              {transferEstimate(count)}
            </p>
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

      {route && !notSetUp && step >= route.steps.length - 1 && (
        <div className="sticky bottom-0 mt-auto bg-gradient-to-b from-transparent to-background to-30% pt-block pb-row">
          <Button
            type="button"
            disabled={!ready || starting}
            onClick={() => void start()}
            variant="ember"
            className="h-11 w-full"
          >
            {starting ? 'Starting…' : ready ? `Transfer ${count} ${count === 1 ? 'song' : 'songs'}` : 'Transfer'}
          </Button>
        </div>
      )}
    </div>
  );
}

/** The first screen: where the songs should go, as two cards on top, and
 *  where they are now, as the four services in rows below, each saying
 *  what a person needs for it. */
function Chooser({
  destination,
  onDestination,
  likedServicesOpen,
  onService,
}: {
  destination: JobKind;
  onDestination: (d: JobKind) => void;
  likedServicesOpen: readonly TransferServiceId[];
  onService: (id: TransferServiceId) => void;
}) {
  return (
    <div className="flex flex-col gap-block">
      <p className="text-sm text-muted-foreground">Where should the songs go?</p>
      <div className="grid grid-cols-2 gap-row">
        {DESTINATIONS.map((d) => {
          const on = destination === d.id;
          return (
            <button
              key={d.id}
              type="button"
              data-testid="transfer-destination-card"
              data-destination={d.id}
              aria-pressed={on}
              onClick={() => onDestination(d.id)}
              className={cn(
                'relative flex min-w-0 flex-col gap-cluster rounded-xl border bg-card p-row text-left transition-colors hover:border-ember',
                on ? 'border-ember bg-ember/10' : 'border-border',
              )}
            >
              <d.icon className="h-5 w-5 text-ember" />
              <span className="text-sm font-semibold">{d.name}</span>
              <span className="text-xs text-muted-foreground">{d.consequence}</span>
              {on && <CheckIcon className="absolute right-row top-row h-4 w-4 text-ember" />}
            </button>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">Where are they now?</p>
      <div className="flex flex-col gap-cluster">
        {TRANSFER_SERVICES.map((s) => {
          const open = serviceOpen(s.id, destination, likedServicesOpen);
          return (
            <button
              key={s.id}
              type="button"
              data-testid="transfer-service-card"
              data-service={s.id}
              data-open={open ? 'true' : 'false'}
              disabled={!open}
              onClick={() => onService(s.id)}
              className="flex w-full items-center gap-row rounded-xl border border-border bg-card px-row py-row text-left transition-colors hover:border-ember disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ServiceMark service={s} size={36} />
              <span className="min-w-0 flex-1">
                <span data-testid="transfer-service-name" className="block text-sm font-semibold">
                  {s.name}
                </span>
                <span className="block text-xs text-muted-foreground">{s.need}</span>
              </span>
              <ChevronRightIcon className="h-4 w-4 text-muted-foreground" />
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">Every service can fill your Liked songs or make a new playlist.</p>
    </div>
  );
}

/** A stand-in for a service's own mark: its letter on its colour. */
export function ServiceMark({ service, size = 28 }: { service: TransferService; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-lg font-extrabold"
      style={{ width: size, height: size, background: service.mark.bg, color: service.mark.fg, fontSize: Math.round(size / 2) }}
    >
      {service.mark.letter}
    </span>
  );
}

/** The Google sign-in, one step at a time: the button, then the code to type
 *  on Google's page with a link to it, then a line while Ember waits. */
function GoogleSignInPanel({ signIn, onSignIn }: { signIn: SignIn; onSignIn: () => void }) {
  if (signIn.step === 'code') {
    const shown = signIn.verificationUrl.replace(/^https?:\/\/(?:www\.)?/, '');
    return (
      <div data-testid="google-code-panel" className="flex flex-col items-center gap-row rounded-lg border border-border bg-card p-block text-center">
        <span className="text-xs text-muted-foreground">Your code</span>
        <span data-testid="google-user-code" className="select-all font-mono text-3xl font-semibold tracking-[0.2em]">
          {signIn.userCode}
        </span>
        <a
          data-testid="google-verification-link"
          href={signIn.verificationUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-cluster rounded-md bg-ember px-row py-cluster text-sm font-medium text-ember-foreground hover:bg-ember-soft"
        >
          <LinkIcon className="h-4 w-4" />
          Open {shown}
        </a>
        <span className="text-xs text-muted-foreground">Type the code there and allow Ember.</span>
        <span data-testid="google-unverified-hint" className="text-xs text-muted-foreground">
          {GOOGLE_UNVERIFIED_HINT}
        </span>
        <p data-testid="google-waiting" role="status" className="text-xs text-muted-foreground">
          {signIn.checking
            ? checkingLine(signIn.checking.done, signIn.checking.total)
            : signIn.reading
              ? 'Google said yes. Reading your likes…'
              : 'Waiting for you to allow Ember…'}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-cluster">
      {signIn.step === 'failed' && (
        <p role="alert" data-testid="transfer-error" className="text-xs text-destructive">
          {signIn.message}
        </p>
      )}
      <Button type="button" variant="secondary" disabled={signIn.step === 'asking'} onClick={onSignIn} className="self-start">
        <KeyIcon className="h-4 w-4" />
        {signIn.step === 'asking' ? 'Asking Google…' : 'Sign in with Google'}
      </Button>
    </div>
  );
}

/** What Ember read out of the file or the pasted list, before anything is
 *  started: how many songs, where they came from, and the first few by name
 *  so an obviously wrong file is obvious. A Google sign-in shows only the
 *  likes YouTube Music calls songs. */
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
