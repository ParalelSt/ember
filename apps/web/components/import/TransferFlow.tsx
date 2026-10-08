'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertIcon, KeyIcon, LinkIcon, UploadIcon } from '@/components/icons';
import { PreviewChips, type CountChip } from '@/components/import/TransferPreviewChips';
import { SOURCE_NAME } from '@/components/import/parts';
import { HaveOptions, StepCard } from '@/components/import/TransferSteps';
import { RadioRow, ServiceMark, TOAST_UP, WhereToSheet, WIZARD_PAGE, WizardBar, WizardProgress, WizardTitle } from '@/components/import/TransferWizard';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { api } from '@/lib/api';
import { QK } from '@/hooks/useLibrary';
import { IMPORT_QK } from '@/hooks/useImports';
import { logger } from '@/lib/logger/client';
import {
  googleLikesErrorMessage,
  KEPT_FIRST_MESSAGE,
  OVER_CAP_MESSAGE,
  transferErrorMessage,
  transferMinutes,
} from '@/lib/import/transferCopy';
import {
  LIKED_SERVICES_OPEN,
  MATCHED_BY_NAME,
  NOTHING_TO_MATCH,
  SPOTIFY_LINK_CAP,
  routesFor,
  serviceById,
  serviceOpen,
  TRANSFER_SERVICES,
  type TransferRoute,
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
import { useTransferStore } from '@/stores/useTransferStore';

/** How often the dialog asks the server how a Google sign-in stands. The
 *  server does the polling of Google itself. */
export const GOOGLE_POLL_MS = 2_000;

export { ServiceMark };

/** A link Ember looked up, flattened so both kinds of source make the
 *  same preview. */
interface LinkLookup {
  url: string;
  kind: ImportSourceKind;
  name: string;
  count: number;
  truncated: boolean;
  /** The first few songs, and which of them the person already liked
   *  (asked only when they go into the likes). */
  sample: { title: string; artist: string }[];
  alreadyLiked: number;
  likedSample: { title: string; artist: string }[];
  newSample: { title: string; artist: string }[];
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
  const follow = useTransferStore((s) => s.follow);
  const router = useRouter();
  const qc = useQueryClient();
  const [destination, setDestination] = useState<JobKind>(initialDestination);
  const [serviceId, setServiceId] = useState<TransferServiceId | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  // Picked on the first screen, before the sheet says where the songs go;
  // and the way in picked on "What do you have", before Next.
  const [picked, setPicked] = useState<TransferServiceId | null>(null);
  const [sheetFor, setSheetFor] = useState<TransferServiceId | null>(null);
  const [pickedRoute, setPickedRoute] = useState<string | null>(null);
  const isDesktop = useIsDesktop();
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
  // A refusal at Start, said on the preview it came from.
  const [startError, setStartError] = useState<string | null>(null);
  // Skip already liked: on until the person turns it off.
  const [skipLiked, setSkipLiked] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const asked = useRef('');

  const resetSource = useCallback(() => {
    setFile(null);
    setText('');
    setUrl('');
    setSignIn({ step: 'idle' });
    setLookup({ step: 'idle' });
    setStartError(null);
    setSkipLiked(true);
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

  const readLink = useCallback(async (link: string, liked: boolean) => {
    const token = `link:${link}`;
    asked.current = token;
    setLookup({ step: 'looking' });
    try {
      const r = await api.importInspect(link, { liked });
      if (asked.current !== token) return;
      const songs =
        r.source === 'spotify'
          ? r.items.map((i) => ({ title: i.title, artist: i.artist }))
          : r.tracks.map((t) => ({ title: t.title, artist: t.artist }));
      setLookup({
        step: 'link',
        preview: {
          url: link,
          kind: r.source === 'spotify' ? 'spotify' : /music\.youtube\.com/i.test(link) ? 'ytmusic' : 'youtube',
          name: r.name,
          count: songs.length,
          truncated: r.source === 'spotify' ? r.truncated : false,
          sample: songs.slice(0, 5),
          alreadyLiked: r.liked?.count ?? 0,
          likedSample: r.liked?.sample ?? [],
          newSample: r.liked?.newSample ?? songs.slice(0, 5),
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

  /** The pasted list or link changed: a sentence about what was there
   *  before is not about this, so it goes. */
  const editSource = () => {
    asked.current = '';
    if (lookup.step === 'error') setLookup({ step: 'idle' });
  };

  /** Continue: read the typed list or the pasted link, then show what is
   *  in it. */
  const typed = routeKind === 'paste' ? text.trim() : routeKind === 'link' ? url.trim() : '';
  const continueTyped = () => {
    if (!typed || lookup.step === 'looking') return;
    if (routeKind === 'paste') void readText(typed);
    else void readLink(typed, destination === 'liked');
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

  /** A service picked: the sheet asks where its songs go. A service that
   *  cannot fill the likes starts on the new playlist. */
  const openSheet = (id: TransferServiceId) => {
    setPicked(id);
    if (destination === 'liked' && !serviceOpen(id, 'liked', likedServicesOpen)) setDestination('playlist');
    setSheetFor(id);
  };

  /** Continue in the sheet: on to that service's ways in. */
  const continueSheet = () => {
    if (!sheetFor) return;
    const id = sheetFor;
    setSheetFor(null);
    setPickedRoute(null);
    pickService(id);
  };

  /** One question back, whichever question that is. A service with a single
   *  way in never asked "what do you have", so its steps go straight back to
   *  the services. The answer you came back from stays picked. */
  const back = () => {
    clearSource();
    // From the preview, back to the step that took the source.
    if (previewed) return;
    setStep(0);
    if (route && choices.length > 1) {
      setPickedRoute(route.id);
      setRouteId(null);
    } else if (service) {
      setPicked(service.id);
      setServiceId(null);
    } else router.push(from);
  };

  // Over the cap, the upload route refuses the start, so the preview says
  // so here instead of letting someone press Start and be turned away. The
  // Google sign-in is different: over the cap it still starts, just with
  // the newest songs kept, so it never sets overCap.
  // A YourLibrary.json is the exception: it starts with the first 10 000.
  const keptFirst = lookup.step === 'file' && lookup.preview.truncated && lookup.preview.kind === 'spotify-export';
  const overCap = lookup.step === 'file' && lookup.preview.truncated && !keptFirst;
  const previewed = lookup.step === 'file' || lookup.step === 'link' || lookup.step === 'google';
  // A Google preview counts songs and the uploads to check separately; both
  // come across, so the button counts both.
  const base = !previewed ? 0 : lookup.step === 'google' ? lookup.preview.count + lookup.preview.toCheck : lookup.preview.count;
  // Songs already liked, by name: only a by-name source going into the
  // likes knows, and only those can be skipped.
  const already =
    destination !== 'liked' ? 0 : lookup.step === 'file' ? (lookup.preview.alreadyLiked ?? 0) : lookup.step === 'link' ? lookup.preview.alreadyLiked : 0;
  const skipping = skipLiked && already > 0;
  const count = skipping ? Math.max(0, base - already) : base;
  const empty = previewed && base === 0 && !overCap;
  const ready = previewed && count > 0 && !overCap;

  /** Started: the progress chip follows it from here, and the person goes
   *  back to where they were. */
  const started = (jobId: string) => {
    follow(jobId);
    toast.success('Transfer started. Ember tells you when it is done.', TOAST_UP);
    router.push(from);
  };

  const start = async () => {
    if (!ready || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      if (lookup.step === 'google') {
        const r = await api.googleLikesStart(lookup.flowId);
        // Started: the server has already dropped the sign-in.
        flowRef.current = null;
        logger.breadcrumb('import', 'transfer queued', { from, destination, source: r.job.source, total: r.job.total });
        void qc.invalidateQueries({ queryKey: IMPORT_QK.jobs });
        void qc.invalidateQueries({ queryKey: QK.likes });
        if (r.note) toast.info(r.note, TOAST_UP);
        started(r.job.id);
        return;
      }
      const r =
        lookup.step === 'link'
          ? await api.importStart(lookup.preview.url, destination, skipping ? { skipLiked: true } : {})
          : await api.transferStart({
              ...(file ? { file } : { text: text.trim() }),
              destination,
              ...(skipping ? { skipLiked: true } : {}),
            });
      logger.breadcrumb('import', 'transfer queued', { from, destination, source: r.job.source, total: r.job.total });
      void qc.invalidateQueries({ queryKey: IMPORT_QK.jobs });
      void qc.invalidateQueries({ queryKey: QK.playlists });
      void qc.invalidateQueries({ queryKey: QK.likes });
      started(r.job.id);
    } catch (e) {
      if (lookup.step === 'google') {
        flowRef.current = null;
        setLookup({ step: 'idle' });
        setSignIn({ step: 'failed', message: googleLikesErrorMessage(e) });
      } else {
        setStartError(transferErrorMessage(e));
      }
    } finally {
      setStarting(false);
    }
  };

  /** The second line under the source's name on the preview. */
  const previewDetail = (): string => {
    if (lookup.step === 'file') return file ? file.name : 'A list of songs';
    if (lookup.step === 'link') return `${SOURCE_NAME[lookup.preview.kind]} playlist`;
    return 'Your YouTube Music likes';
  };

  /** The counts as chips, each with the songs it means. */
  const previewChips = (): CountChip[] => {
    const out: CountChip[] = [];
    if (lookup.step === 'google') {
      out.push({ id: 'new', label: `${lookup.preview.count.toLocaleString('en-GB')} songs`, count: lookup.preview.count, songs: lookup.preview.sample });
      if (lookup.preview.toCheck > 0) {
        out.push({ id: 'check', label: `${lookup.preview.toCheck} to check`, count: lookup.preview.toCheck, note: toCheckLine(lookup.preview.toCheck) });
      }
      return out;
    }
    if (lookup.step !== 'file' && lookup.step !== 'link') return out;
    const p = lookup.preview;
    const fresh = Math.max(0, p.count - already);
    const newSample = p.newSample ?? p.sample;
    out.push({ id: 'new', label: `${fresh.toLocaleString('en-GB')} new`, count: fresh, songs: newSample });
    if (already > 0) {
      out.push({
        id: 'liked',
        label: `${already.toLocaleString('en-GB')} already liked`,
        count: already,
        songs: p.likedSample ?? [],
        note: skipping ? 'Skipped: they stay as they are.' : 'Looked up again; nothing changes for them.',
      });
    }
    if (lookup.step === 'file') {
      const f = lookup.preview;
      if (f.duplicates) {
        out.push({
          id: 'double',
          label: `${f.duplicates} twice in the file`,
          count: f.duplicates,
          songs: f.duplicateSample ?? [],
          note: 'Brought over once.',
        });
      }
      if (f.unreadable) {
        out.push({
          id: 'bad',
          label: `${f.unreadable} unreadable`,
          count: f.unreadable,
          note: `${f.unreadable === 1 ? 'One row has' : `${f.unreadable} rows have`} no song Ember could read, so ${f.unreadable === 1 ? 'it is' : 'they are'} left out.`,
        });
      }
      if (f.truncated) {
        out.push({
          id: 'over',
          label: f.overLimit ? `${f.overLimit.toLocaleString('en-GB')} over the limit` : 'Over the limit',
          count: f.overLimit ?? 0,
          note: keptFirst ? KEPT_FIRST_MESSAGE : OVER_CAP_MESSAGE,
        });
      }
    }
    return out;
  };

  const stage: 'start' | 'have' | 'steps' | 'preview' = !service ? 'start' : previewed ? 'preview' : !route ? 'have' : 'steps';
  const title =
    stage === 'start'
      ? 'Transfer songs into Ember'
      : stage === 'preview'
        ? 'Before you start'
        : stage === 'have'
          ? 'What do you have already?'
          : (service?.heading ?? '');
  const lastStep = !!route && step >= route.steps.length - 1;

  /** Back in the bottom bar: a step at a time through the steps, then one
   *  question back. */
  const barBack = () => {
    if (stage === 'steps' && !notSetUp && step > 0) {
      // Leaving the sign-in step leaves the sign-in: the server revokes it now.
      if (routeKind === 'google') clearSource();
      setStep(step - 1);
    } else back();
  };

  /** What the bottom bar offers next, on each screen. */
  const barNext = () => {
    if (stage === 'start') {
      return (
        <Button type="button" variant="ember" disabled={!picked} onClick={() => picked && openSheet(picked)} className="h-11 flex-1">
          Next
        </Button>
      );
    }
    if (stage === 'have') {
      return (
        <Button type="button" variant="ember" disabled={!pickedRoute} onClick={() => pickedRoute && pickRoute(pickedRoute)} className="h-11 flex-1">
          Next
        </Button>
      );
    }
    if (stage === 'preview') {
      return (
        <Button type="button" disabled={!ready || starting} onClick={() => void start()} variant="ember" className="h-11 flex-1">
          {starting ? 'Starting…' : `Transfer ${count.toLocaleString('en-GB')} ${count === 1 ? 'song' : 'songs'}`}
        </Button>
      );
    }
    if (!route || notSetUp) return null;
    if (!lastStep) {
      return (
        <Button type="button" variant="ember" onClick={() => setStep(step + 1)} className="h-11 flex-1">
          Next step
        </Button>
      );
    }
    if (routeKind === 'paste' || routeKind === 'link') {
      return (
        <Button type="button" disabled={!typed || lookup.step === 'looking'} onClick={continueTyped} variant="ember" className="h-11 flex-1">
          Continue
        </Button>
      );
    }
    return null;
  };
  const barHint =
    stage === 'steps' && lastStep && !notSetUp
      ? routeKind === 'google'
        ? 'Sign in above to go on'
        : routeKind === 'file'
          ? 'Choose the file above to go on'
          : ''
      : '';

  return (
    <div data-testid="transfer-page" data-stage={stage} className={WIZARD_PAGE}>
      <div className="flex flex-col pt-inset">
        <WizardProgress at={stage === 'start' ? 0 : stage === 'preview' ? 2 : 1} />
        <WizardTitle>{title}</WizardTitle>
      </div>

      {stage === 'start' ? (
        <div className="flex flex-col gap-row">
          <p className="text-sm text-muted-foreground">Where are your songs now?</p>
          <div role="radiogroup" aria-label="Where your songs are now" className="flex flex-col gap-cluster">
            {TRANSFER_SERVICES.map((s) => (
              <RadioRow
                key={s.id}
                data-testid="transfer-service-card"
                data-service={s.id}
                on={picked === s.id}
                onClick={() => openSheet(s.id)}
                lead={<ServiceMark service={s} size={36} />}
                titleTestId="transfer-service-name"
                title={s.name}
                sub={s.need}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Next you say where they go: your Liked songs or a new playlist.</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-col gap-block">
          {stage === 'have' && <HaveOptions choices={choices} picked={pickedRoute} onPick={setPickedRoute} />}

          {previewed && service && (
            <PreviewChips
              mark={<ServiceMark service={service} size={22} />}
              label={lookup.step === 'link' ? lookup.preview.name : lookup.preview.label}
              detail={previewDetail()}
              total={count}
              estimate={transferMinutes(count, lookup.step === 'google' || lookup.preview.kind === 'ytmusic' || lookup.preview.kind === 'youtube')}
              chips={previewChips()}
              destination={destination}
              skip={{ available: already > 0, on: skipLiked, onToggle: () => setSkipLiked((v) => !v) }}
              note={lookup.step === 'google' ? NOTHING_TO_MATCH : MATCHED_BY_NAME}
            >
              {lookup.step === 'google' && lookup.preview.toCheck > 0 && (
                <p data-testid="google-to-check" className="text-center text-xs text-muted-foreground">
                  {toCheckLine(lookup.preview.toCheck)}
                </p>
              )}
              {lookup.step === 'link' && lookup.preview.truncated && (
                <p data-testid="transfer-link-cap" className="text-center text-xs text-muted-foreground">
                  {SPOTIFY_LINK_CAP}
                </p>
              )}
              {keptFirst && (
                <p data-testid="transfer-kept-first" className="text-center text-xs text-muted-foreground">
                  {KEPT_FIRST_MESSAGE}
                </p>
              )}
              {overCap && (
                <p role="alert" data-testid="transfer-over-cap" className="text-center text-xs text-destructive">
                  {OVER_CAP_MESSAGE}
                </p>
              )}
              {empty && (
                <p role="alert" data-testid="transfer-empty" className="text-center text-xs text-destructive">
                  There are no songs in that.
                </p>
              )}
              {startError && (
                <p role="alert" data-testid="transfer-error" className="text-center text-xs text-destructive">
                  {startError}
                </p>
              )}
            </PreviewChips>
          )}

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

          {route && !notSetUp && !previewed && (
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
                        editSource();
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
                          editSource();
                        }}
                        placeholder={serviceId === 'ytmusic' ? 'Paste the YouTube Music playlist link' : 'Paste the Spotify playlist link'}
                        className="truncate pl-10"
                      />
                    </div>
                  )}

                  {route.kind === 'google' && <GoogleSignInPanel signIn={signIn} onSignIn={() => void beginSignIn()} />}

                  {lookup.step === 'looking' && (
                    <p role="status" className="text-xs text-muted-foreground">
                      Reading it…
                    </p>
                  )}
                  {lookup.step === 'error' && (
                    <p role="alert" data-testid="transfer-error" className="text-xs text-destructive">
                      {lookup.message}
                    </p>
                  )}
                </div>
              }
            />
          )}
        </div>
      )}

      <WizardBar onBack={barBack} hint={barHint}>
        {barNext()}
      </WizardBar>

      <WhereToSheet
        service={sheetFor ? serviceById(sheetFor) : null}
        open={!!sheetFor}
        onOpenChange={(o) => !o && setSheetFor(null)}
        destination={destination}
        onDestination={setDestination}
        likedOpen={!!sheetFor && serviceOpen(sheetFor, 'liked', likedServicesOpen)}
        onContinue={continueSheet}
        side={isDesktop ? 'right' : 'bottom'}
      />
    </div>
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
