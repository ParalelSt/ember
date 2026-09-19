'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '@/components/icons';
import { CollectionPage } from '@/components/library/CollectionPage';
import { hrefFor } from '@/lib/collections';
import { MOCK_IMPORT_PROGRESS, MOCK_IMPORT_SOURCES, MOCK_LIKED_TRACKS } from '@/app/(app)/dizajn/mock';
import { MOCK_SIDEBAR_PLAYLISTS, ShellPreview } from '@/components/library/options/changelog/ShellPreview';
import { ScaledFrame } from '@/components/library/options/changelog/ChangelogSection';
import {
  IMPORT_CHOICE_STYLES,
  IMPORT_REVIEW_STYLES,
  IMPORT_STEPS,
  type ImportChoiceStyle,
  type ImportReviewStyle,
  type ImportSourceId,
  type ImportStep,
} from '@/components/library/options/imports';
import { ImportDialog } from '@/components/library/options/imports/ImportDialog';
import {
  Actions,
  ImportPlaylistPage,
  importCounts,
  PhoneHeader,
  PhoneTrackRow,
} from '@/components/library/options/imports/ImportPlaylistPage';
import { REVIEW_ITEMS, ReviewPage, ReviewSheet, SHEET_KEYS } from '@/components/library/options/imports/ReviewScreens';
import { ProgressRing } from '@/components/library/options/imports/parts';

const DESKTOP = { width: 1100, height: 700 };
const PHONE = { width: 390, height: 780 };
const IMPORT_HREF = '/playlist/mock-import';
const LIKED_HREF = hrefFor({ kind: 'liked' });
// The imported playlist takes the mock's "Late Night Drive" slot, so the
// sidebar does not list the same name twice.
const OTHER_PLAYLISTS = MOCK_SIDEBAR_PLAYLISTS.filter((p) => p.id !== 'p1');

/** The new playlist's sidebar row: highlighted (it is the open page), with
 *  the running count and ring while importing, and how many songs wait for
 *  a look once done. */
function ImportNavRow({ phase, toReview, name }: { phase: 'importing' | 'done'; toReview: number; name: string }) {
  const { done, total } = MOCK_IMPORT_PROGRESS;
  return (
    <div
      data-testid="import-nav-row"
      className="flex items-center gap-cluster rounded-md bg-sidebar-accent px-row py-cluster text-sm text-sidebar-accent-foreground"
    >
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {phase === 'importing' ? (
        <>
          <span className="shrink-0 text-[11px] tabular-nums text-sidebar-foreground/55">
            {done} of {total}
          </span>
          <ProgressRing done={done} total={total} size={14} />
        </>
      ) : toReview > 0 ? (
        <span className="inline-flex shrink-0 items-center gap-inset text-[11px] text-ember" title={`${toReview} songs to review`}>
          <span className="size-1.5 rounded-full bg-ember" />
          {toReview} to review
        </span>
      ) : null}
    </div>
  );
}

/** What sits behind the dialog: the Liked songs page, the real
 *  CollectionPage on desktop and its phone-shaped copy in the phone frame. */
function BehindDialog({ phone }: { phone: boolean }) {
  if (phone) {
    return (
      <div className="flex flex-col gap-stack">
        <PhoneHeader title="Liked songs" meta={[`${MOCK_LIKED_TRACKS.length} songs`, '15 min']} cover={{ src: null, icon: 'heart' }} actions={<Actions />} />
        <div className="flex flex-col">
          {MOCK_LIKED_TRACKS.map((t, i) => (
            <PhoneTrackRow key={t.id} track={t} index={i} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <CollectionPage
      eyebrow="Playlist"
      title="Liked songs"
      meta={[`${MOCK_LIKED_TRACKS.length} songs`, '15 min']}
      cover={{ src: null, icon: 'heart' }}
      tracks={MOCK_LIKED_TRACKS}
      context={{ type: 'liked' }}
      playback={{ play: () => {}, shuffle: () => {}, shuffleOn: false, active: false }}
      download={null}
      trackActions={{
        currentId: null,
        isPlaying: false,
        likedIds: new Set(MOCK_LIKED_TRACKS.map((t) => t.id)),
        onPlay: () => {},
        onToggle: () => {},
        onLike: () => {},
      }}
      emptyMessage="No liked songs yet."
    />
  );
}

export interface ImportsSectionProps {
  choiceStyle: ImportChoiceStyle;
  step: ImportStep;
  review: ImportReviewStyle;
  /** Changes on every Review screen picker click: opens that screen. */
  reviewRequest: number;
  sourceId: ImportSourceId;
  /** Create in the dialog moves the Step picker to Importing, so the
   *  preview behaves like the real thing. */
  onStepChange: (step: ImportStep) => void;
}

/** The playlist import candidates in context: the whole Ember shell twice
 *  (desktop scaled to fit, phone at 390px) plus a 1:1 full-screen view,
 *  with the create-playlist dialog, the filling playlist and the review
 *  screens drawn from mock data. Picks, skips and accepts all work locally
 *  so the owner can click through; nothing persists except the page's
 *  pickers. */
export function ImportsSection({ choiceStyle, step, review, reviewRequest, sourceId, onStepChange }: ImportsSectionProps) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [openItemId, setOpenItemId] = useState<string | null>(REVIEW_ITEMS[0].id);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [sheetShowAll, setSheetShowAll] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [desktopScale, setDesktopScale] = useState(1);

  // A new combination starts the click-through over. Picking a Review
  // screen opens it (the page also moves Step to Done); leaving Done
  // closes it. Adjusted during render, not in an effect, so the stale
  // combination never paints.
  const [prev, setPrev] = useState({ choiceStyle, step, review, reviewRequest });
  if (
    prev.choiceStyle !== choiceStyle ||
    prev.step !== step ||
    prev.review !== review ||
    prev.reviewRequest !== reviewRequest
  ) {
    setPrev({ choiceStyle, step, review, reviewRequest });
    setResolved({});
    setChoices({});
    setOpenItemId(REVIEW_ITEMS[0].id);
    setSheetIndex(0);
    setSheetShowAll(false);
    setDrawerOpen(false);
    setReviewOpen(step === 'done' && (prev.reviewRequest !== reviewRequest || (prev.step === 'done' && reviewOpen)));
  }

  const source = MOCK_IMPORT_SOURCES.find((s) => s.id === sourceId) ?? MOCK_IMPORT_SOURCES[0];
  const inDialog = step === 'choose' || step === 'pasted';
  const showReview = step === 'done' && reviewOpen;
  const counts = importCounts(resolved);

  const pick = (itemId: string, candidateId: string) => {
    const next = { ...resolved, [itemId]: candidateId };
    setResolved(next);
    // Inline: move straight on to the next unsure row.
    setOpenItemId(REVIEW_ITEMS.find((i) => !next[i.id])?.id ?? null);
  };
  const sheetPick = (itemId: string, candidateId: string) => {
    pick(itemId, candidateId);
    setSheetIndex((i) => i + 1);
    setSheetShowAll(false);
  };
  const sheetSkip = () => {
    setSheetIndex((i) => i + 1);
    setSheetShowAll(false);
  };
  const openReview = () => {
    setReviewOpen(true);
    setOpenItemId(REVIEW_ITEMS.find((i) => !resolved[i.id])?.id ?? null);
    setSheetIndex(0);
  };
  const acceptOne = (itemId: string) => {
    const item = REVIEW_ITEMS.find((i) => i.id === itemId)!;
    setResolved((r) => ({ ...r, [itemId]: choices[itemId] ?? item.candidates![0].id }));
  };
  const acceptAll = () =>
    setResolved((r) => {
      const next = { ...r };
      for (const i of REVIEW_ITEMS) next[i.id] ??= choices[i.id] ?? i.candidates![0].id;
      return next;
    });

  // The side sheet's keys: 1 to 3 pick, S skips. One listener for every
  // frame, since both frames (and full screen) share this state.
  const sheetActive = showReview && review === 'sheet';
  useEffect(() => {
    if (!sheetActive) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const item = REVIEW_ITEMS[sheetIndex];
      if (!item) return;
      const n = Number(e.key);
      if (n >= 1 && n <= SHEET_KEYS && item.candidates?.[n - 1]) {
        sheetPick(item.id, item.candidates[n - 1].id);
      } else if (e.key === 's' || e.key === 'S') {
        sheetSkip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const shell = (phone: boolean) => {
    let content;
    if (inDialog) content = <BehindDialog phone={phone} />;
    else if (showReview && review === 'page')
      content = (
        <ReviewPage
          phone={phone}
          source={source}
          choices={choices}
          resolved={resolved}
          onChoose={(itemId, cid) => setChoices((c) => ({ ...c, [itemId]: cid }))}
          onAccept={acceptOne}
          onAcceptAll={acceptAll}
        />
      );
    else
      content = (
        <ImportPlaylistPage
          phone={phone}
          source={source}
          phase={step === 'importing' ? 'importing' : 'done'}
          resolved={resolved}
          inlineReview={showReview && review === 'inline'}
          openItemId={openItemId}
          onOpenItem={setOpenItemId}
          onPick={pick}
          onReview={openReview}
        />
      );

    return (
      <ShellPreview
        phone={phone}
        activePath={inDialog ? LIKED_HREF : IMPORT_HREF}
        content={content}
        playlists={OTHER_PLAYLISTS}
        playlistsTop={
          inDialog ? undefined : (
            <ImportNavRow phase={step === 'importing' ? 'importing' : 'done'} toReview={counts.review} name={source.name} />
          )
        }
        modal={
          inDialog ? (
            <ImportDialog
              key={`${choiceStyle}:${step}:${sourceId}`}
              style={choiceStyle}
              pasted={step === 'pasted'}
              source={source}
              phone={phone}
              onCreate={() => onStepChange('importing')}
            />
          ) : undefined
        }
        overlay={
          showReview && review === 'sheet' ? (
            <ReviewSheet
              phone={phone}
              source={source}
              index={sheetIndex}
              showAll={sheetShowAll}
              onShowAll={() => setSheetShowAll(true)}
              onPick={sheetPick}
              onSkip={sheetSkip}
              onClose={() => setReviewOpen(false)}
            />
          ) : undefined
        }
        drawerOpen={phone && drawerOpen}
        onDrawerOpenChange={setDrawerOpen}
      />
    );
  };

  const description = [
    IMPORT_CHOICE_STYLES.find((o) => o.id === choiceStyle)?.description,
    IMPORT_STEPS.find((o) => o.id === step)?.description,
    showReview ? IMPORT_REVIEW_STYLES.find((o) => o.id === review)?.description : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      data-testid="imports-section"
      data-style={choiceStyle}
      data-step={step}
      data-review={review}
      data-review-open={showReview}
    >
      <div className="flex flex-col gap-stack lg:flex-row lg:items-start">
        <div className="min-w-0 lg:flex-[1100_1_0%]">
          <div className="mb-cluster flex min-h-7 items-center justify-between gap-row">
            <div className="text-eyebrow">
              Desktop <span className="normal-case tracking-normal">({Math.round(desktopScale * 100)}%)</span>
            </div>
            <button
              type="button"
              onClick={() => setFullscreen(true)}
              className="rounded-full border border-border px-row py-inset text-xs font-medium transition-colors hover:bg-card"
            >
              View full screen
            </button>
          </div>
          <ScaledFrame width={DESKTOP.width} height={DESKTOP.height} onScale={setDesktopScale}>
            {shell(false)}
          </ScaledFrame>
        </div>
        <div className="w-full min-w-0 max-w-[390px] lg:flex-[390_1_0%]">
          <div className="mb-cluster flex min-h-7 items-center justify-between gap-row">
            <div className="text-eyebrow">Phone (390px)</div>
            {!inDialog && (
              <button
                type="button"
                onClick={() => setDrawerOpen((o) => !o)}
                aria-pressed={drawerOpen}
                className="rounded-full border border-border px-row py-inset text-xs font-medium transition-colors hover:bg-card"
              >
                {drawerOpen ? 'Close menu' : 'Open menu'}
              </button>
            )}
          </div>
          <ScaledFrame width={PHONE.width} height={PHONE.height}>
            {shell(true)}
          </ScaledFrame>
        </div>
      </div>

      <p data-testid="imports-description" className="mt-block text-meta">
        {description}
      </p>

      {fullscreen &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Full screen preview"
            data-testid="imports-fullscreen"
            className="fixed inset-0 z-[70] bg-background"
          >
            {shell(false)}
            <div className="absolute left-1/2 top-3 z-[80] flex -translate-x-1/2 items-center gap-cluster rounded-full border border-border bg-popover/95 py-inset pl-block pr-inset text-xs text-muted-foreground shadow-soft backdrop-blur">
              Full-size preview, Esc to close
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                aria-label="Close full screen"
                className="grid h-7 w-7 place-items-center rounded-full text-foreground transition-colors hover:bg-muted"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
