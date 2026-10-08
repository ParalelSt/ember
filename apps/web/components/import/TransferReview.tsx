'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Artwork } from '@/components/primitives/Artwork';
import { CheckIcon, ChevronLeftIcon, HeartIcon, MusicIcon, PauseIcon, PlayIcon, PlusIcon, SearchIcon } from '@/components/icons';
import { CandidateRow, SOURCE_NAME } from '@/components/import/parts';
import { SearchPanel } from '@/components/import/ReviewSheet';
import { resultLine } from '@/components/import/TransferStatus';
import { TOAST_UP, WIZARD_PAGE, WizardBar, WizardTitle } from '@/components/import/TransferWizard';
import { useImportActions, useImportJob, useImportJobs } from '@/hooks/useImports';
import { useImportReview } from '@/hooks/useImportReview';
import { isActive } from '@/lib/import/jobState';
import { followedTransfer } from '@/lib/import/transferFollow';
import type { ImportItem } from '@/lib/import/types';
import { useTransferStore } from '@/stores/useTransferStore';
import type { Track } from '@/types/track';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/** A best guess this close or closer is marked as a strong match. */
const STRONG_MATCH = 65;

/** What the person did with a song on this list, so the row can say so and
 *  Undo knows what it was before. */
interface Decision {
  kind: 'used' | 'skipped';
  /** The song it was before: unsure, or not found. */
  from: 'review' | 'missing';
  /** The version used. */
  title?: string;
}

/** Every song of a transfer that Ember was not sure about, on one page:
 *  each a card with its best guess's artwork large (tap it to hear it), Use
 *  this, Others (the other candidates and a search), Skip, and Undo once
 *  decided; and "Use all best guesses" in the bar at the bottom. Opened
 *  from the "Transfer done" card or the pill. */
export function TransferReview({ jobId }: { jobId?: string }) {
  const router = useRouter();
  const { data: jobs = [] } = useImportJobs();
  const followed = useTransferStore((s) => s.followed);
  const id = jobId || followedTransfer(jobs, followed)?.id || null;
  const { data, isLoading } = useImportJob(id);
  const job = data?.job ?? null;
  const items = useMemo(() => data?.items ?? [], [data]);
  const actions = useImportActions(job?.id, job?.playlistId ?? null);
  const review = useImportReview(items);
  const [decided, setDecided] = useState<Record<string, Decision>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [usingAll, setUsingAll] = useState(false);

  // The songs to check, unsure ones first then the ones not found, each in
  // source order; a song decided here keeps its place so Undo is beside it.
  const rows = useMemo(() => {
    const group = (i: ImportItem) => (decided[i.id]?.from ?? i.status) === 'review' ? 0 : 1;
    return items
      .filter((i) => i.status === 'review' || i.status === 'missing' || decided[i.id])
      .sort((a, b) => group(a) - group(b) || a.position - b.position);
  }, [items, decided]);
  const open = rows.filter((i) => !decided[i.id]);
  const bestable = open.filter((i) => i.status === 'review' && i.candidates.length > 0);
  const liked = job?.kind !== 'playlist';
  const verb = liked ? 'Liked' : 'Added';
  const backHref = job?.playlistId ? `/playlist/${job.playlistId}` : '/library/liked';

  const decide = (item: ImportItem, d: Decision) => setDecided((m) => ({ ...m, [item.id]: d }));
  const fromOf = (item: ImportItem): 'review' | 'missing' => (item.status === 'missing' ? 'missing' : 'review');

  const use = (item: ImportItem, track: Track) => {
    const from = fromOf(item);
    actions.pick.mutate(
      { itemId: item.id, track },
      {
        onSuccess: () => {
          decide(item, { kind: 'used', from, title: track.title });
          if (openId === item.id) setOpenId(null);
          toast.success(`${verb} "${track.title}"`, TOAST_UP);
        },
        onError: (e) => toast.error(`Couldn't ${liked ? 'like' : 'add'} that song: ${(e as Error).message}`, TOAST_UP),
      },
    );
  };
  const skip = (item: ImportItem) => {
    const from = fromOf(item);
    actions.skip.mutate(item.id, {
      onSuccess: () => {
        decide(item, { kind: 'skipped', from });
        if (openId === item.id) setOpenId(null);
      },
      onError: (e) => toast.error((e as Error).message, TOAST_UP),
    });
  };
  const undo = (item: ImportItem) => {
    const d = decided[item.id];
    if (!d) return;
    actions.undo.mutate(
      { itemId: item.id, to: d.from },
      {
        onSuccess: () =>
          setDecided((m) => {
            const next = { ...m };
            delete next[item.id];
            return next;
          }),
        onError: (e) => toast.error((e as Error).message, TOAST_UP),
      },
    );
  };
  const takeAllGuesses = async () => {
    if (usingAll) return;
    setUsingAll(true);
    let done = 0;
    try {
      for (const item of bestable) {
        await actions.pick.mutateAsync({ itemId: item.id, track: item.candidates[0].track });
        decide(item, { kind: 'used', from: 'review', title: item.candidates[0].track.title });
        done += 1;
      }
      toast.success(`${verb} ${done} ${done === 1 ? 'song' : 'songs'}`, TOAST_UP);
    } catch (e) {
      toast.error(`Stopped after ${done}: ${(e as Error).message}`, TOAST_UP);
    } finally {
      setUsingAll(false);
    }
  };
  const toggleOthers = (item: ImportItem) => {
    // A search for another song is not this one's.
    review.close();
    setOpenId(openId === item.id ? null : item.id);
  };
  const finish = () => {
    if (job && !isActive(job.status)) actions.update.mutate('dismiss');
    router.push(backHref);
  };

  const backLink = (
    <Link
      href={backHref}
      className="inline-flex h-11 shrink-0 items-center gap-inset rounded-lg border border-border px-row text-sm font-medium hover:bg-muted"
    >
      <ChevronLeftIcon className="h-4 w-4" />
      Back
    </Link>
  );

  if (!id || (!isLoading && !job)) {
    return (
      <div data-testid="transfer-review" className={WIZARD_PAGE}>
        <WizardTitle>Nothing to check</WizardTitle>
        <p className="text-sm text-muted-foreground">There is no transfer with songs to check right now.</p>
        <WizardBar back={backLink} />
      </div>
    );
  }
  if (!job) return <div data-testid="transfer-review" className="mx-auto w-full max-w-2xl text-sm text-muted-foreground">Loading…</div>;

  const running = isActive(job.status);
  const UseIcon = liked ? HeartIcon : PlusIcon;
  return (
    <div data-testid="transfer-review" className={WIZARD_PAGE}>
      <WizardTitle>{rows.length ? `${rows.length} ${rows.length === 1 ? 'song' : 'songs'} to check` : 'Nothing to check'}</WizardTitle>
      <p data-testid="transfer-review-result" className="text-sm text-muted-foreground">
        {running ? `Still transferring, ${job.cursor} of ${job.total}. More may join this list.` : resultLine(job)}
      </p>
      {open.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Ember was not sure about these. Tap the artwork to hear it, then use it, pick another version, or skip.
        </p>
      )}

      <div className="flex flex-col gap-row" data-testid="transfer-review-list">
        {rows.map((item) => {
          const d = decided[item.id];
          if (d) {
            return (
              <div
                key={item.id}
                data-testid="transfer-review-done"
                className="flex items-center gap-row rounded-xl border border-border bg-card px-row py-cluster opacity-80"
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {d.kind === 'used' ? `${verb} ` : 'Skipped '}
                  <b>{d.kind === 'used' ? d.title : item.source.title}</b>
                </span>
                <button
                  type="button"
                  disabled={actions.busy}
                  onClick={() => undo(item)}
                  className="text-xs text-ember underline underline-offset-2 disabled:opacity-60"
                >
                  Undo
                </button>
              </div>
            );
          }
          const missing = item.status === 'missing' || item.candidates.length === 0;
          const best = item.candidates[0];
          const expanded = openId === item.id;
          const hearing = !!best && review.previewId === best.track.id && review.previewPlaying;
          return (
            <div
              key={item.id}
              data-testid="transfer-review-item"
              data-status={item.status}
              className="flex flex-col gap-row rounded-[20px] border border-border bg-card p-row"
            >
              <div className="truncate text-xs text-muted-foreground">
                On {SOURCE_NAME[job.source]}: <span className="text-foreground">{item.source.title}</span>
                {item.source.artist ? `, ${item.source.artist}` : ''}
              </div>
              <div className="flex min-w-0 items-center gap-row">
                {missing ? (
                  <span
                    data-testid="transfer-review-missing"
                    className="grid size-21 shrink-0 place-items-center rounded-[14px] border-[1.5px] border-dashed border-border text-muted-foreground"
                  >
                    <SearchIcon className="h-5 w-5" />
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid="transfer-review-art"
                    onClick={() => review.onPreview(best.track)}
                    aria-label={`${hearing ? 'Pause' : 'Preview'} "${best.track.title}"`}
                    aria-pressed={hearing}
                    className={cn(
                      'group relative size-21 shrink-0 rounded-[14px] shadow-lg',
                      hearing && 'ring-2 ring-ember ring-offset-2 ring-offset-card',
                    )}
                  >
                    <Artwork
                      src={best.track.artworkUrl}
                      className="grid size-21 place-items-center rounded-[14px] bg-art text-foreground/20"
                    >
                      <MusicIcon className="h-6 w-6" />
                    </Artwork>
                    <span className="absolute inset-0 grid place-items-center">
                      <span className="grid size-10 place-items-center rounded-full bg-background/60 text-foreground backdrop-blur transition-colors group-hover:bg-background/80">
                        {hearing ? <PauseIcon className="h-4 w-4 fill-current" /> : <PlayIcon className="h-4 w-4 fill-current" />}
                      </span>
                    </span>
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  {missing ? (
                    <>
                      <div className="truncate text-base font-bold">Nothing close enough</div>
                      <div className="truncate text-[13px] text-muted-foreground">Search YouTube Music for it</div>
                    </>
                  ) : (
                    <>
                      <div data-testid="transfer-review-guess" className="truncate text-base font-bold">
                        {best.track.title}
                      </div>
                      <div className="truncate text-[13px] text-muted-foreground">
                        {best.artists.length ? best.artists.join(', ') : best.track.artist}
                        {best.track.durationSec ? ` · ${formatTime(best.track.durationSec)}` : ''}
                      </div>
                      <span
                        data-testid="transfer-review-match"
                        data-strong={best.score >= STRONG_MATCH ? 'true' : 'false'}
                        className={cn(
                          'mt-inset inline-flex items-center rounded-full px-cluster text-[11.5px] font-semibold leading-5',
                          best.score >= STRONG_MATCH ? 'bg-foreground/10 text-foreground' : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {best.score}% match
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-cluster">
                {missing ? (
                  <Button type="button" variant="outline" className="h-10 flex-1" aria-expanded={expanded} onClick={() => toggleOthers(item)}>
                    <SearchIcon className="h-3.5 w-3.5" />
                    Search
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="ember"
                      className="h-10 flex-1"
                      disabled={actions.busy || usingAll}
                      onClick={() => use(item, best.track)}
                    >
                      <UseIcon className="h-3.5 w-3.5" />
                      Use this
                    </Button>
                    <Button type="button" variant="outline" className="h-10" aria-expanded={expanded} onClick={() => toggleOthers(item)}>
                      {expanded ? 'Hide' : 'Others'}
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 text-muted-foreground"
                  disabled={actions.busy || usingAll}
                  onClick={() => skip(item)}
                >
                  Skip
                </Button>
              </div>
              {expanded && (
                <div data-testid="transfer-review-others" className="flex flex-col gap-cluster border-t border-border pt-cluster">
                  {!missing &&
                    (item.candidates.length > 1 ? (
                      <div className="-mx-row flex flex-col">
                        {item.candidates.slice(1).map((c) => (
                          <CandidateRow
                            key={c.track.id}
                            candidate={c}
                            disabled={actions.busy}
                            previewing={review.previewId === c.track.id}
                            playing={review.previewPlaying}
                            onPick={() => use(item, c.track)}
                            onPreview={() => review.onPreview(c.track)}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No other versions came back. Search for one:</p>
                    ))}
                  <SearchPanel
                    key={item.id}
                    initial={`${item.source.title} ${item.source.artist}`.trim()}
                    results={review.searchResults}
                    searching={review.searching}
                    busy={actions.busy}
                    onSearch={review.onSearch}
                    onUse={(t) => use(item, t)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {open.length === 0 && !running && (
        <div data-testid="transfer-review-all-done" className="flex flex-col items-center gap-cluster py-block text-center">
          <span className="grid size-10 place-items-center rounded-full bg-ember/15 text-ember">
            <CheckIcon className="h-5 w-5" />
          </span>
          <div className="text-base font-semibold">All sorted</div>
          <Button type="button" variant="outline" onClick={finish}>
            Done
          </Button>
        </div>
      )}

      <WizardBar back={backLink}>
        {bestable.length > 0 ? (
          <Button type="button" variant="ember" className="h-11 flex-1" disabled={usingAll || actions.busy} onClick={() => void takeAllGuesses()}>
            Use all best guesses ({bestable.length})
          </Button>
        ) : null}
      </WizardBar>
    </div>
  );
}
