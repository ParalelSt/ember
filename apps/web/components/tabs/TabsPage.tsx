'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  MoreIcon,
  PlayIcon,
  RepeatIcon,
  SearchIcon,
  TabsIcon,
  UploadIcon,
} from '@/components/icons';
import { EmptyState } from '@/components/page/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { usePlayer } from '@/components/player/PlayerProvider';
import { LiveTabScore } from '@/components/tabs/LiveTabScore';
import { TabSheetHeader, TabSourceChip } from '@/components/tabs/TabSheetHeader';
import { TabSourceSheet, type TabSheetAction } from '@/components/tabs/TabSourceSheet';
import { TabsToolbar, chip, chipOff, chipOn } from '@/components/tabs/TabsToolbar';
import { useTabAlignment, useTabSong, useTabSources, type TabSong, type TabSourcesState } from '@/hooks/useTabSources';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { cn } from '@/lib/utils';
import { metaLine, scoreScale, type ScoreInfo, type TabsScroll, type TabsStaff } from '@/lib/tabScore';
import { emptyStateFor, followTrackChange, sourceChipLabel, type TabSummary } from '@/lib/tabSources';
import type { TabMatch } from '@/lib/songsterr';
import { chooseTab, confidencePercent, loadPick, savePick, sheetRows } from '@/lib/tabPick';
import {
  clampOffset,
  isLinedUp,
  loadLocalOffsetMs,
  saveLocalOffsetMs,
  songSecToTabMs,
  syncPoints,
  tabMsToSongSecAligned,
} from '@/lib/tabSync';
import { barStartsOf, bpmAtMs, steadyBeats, tabBeats, tempoSteps, type Click, type TabTimeline } from '@/lib/tabTimeline';
import { clickContext } from '@/lib/metronome';
import { useMetronome } from '@/hooks/useMetronome';
import { usePracticeLoop } from '@/hooks/usePracticeLoop';
import {
  barCount,
  bpmAtRate,
  loopSpanMs,
  normalizeRange,
  pickBar,
  rangeLabel,
  rateFromBpm,
  rateFromPercent,
  sectionRanges,
  SPEED_PRESETS,
  type BarRange,
  type SectionRange,
} from '@/lib/tabPractice';
import {
  beatClockOf,
  formatOffset,
  nudgeSteps,
  offsetFromInput,
  offsetInUnit,
  sliderSpanSec,
  type BeatClock,
  type OffsetUnit,
} from '@/lib/tabOffset';
import { tabSearchLinks, type TabSearchLink } from '@/lib/tabSearchLinks';
import { openExternal } from '@/lib/openExternal';
import { announceOpen } from '@/components/ExternalLinks';

const TAB_ACCEPT = '.gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.xml,.mxl';
const STAFF_KEY = 'ember.tabs.staff';
const SCROLL_KEY = 'ember.tabs.scroll';
const OFFSET_UNIT_KEY = 'ember.tabs.offsetUnit';
const trackKey = (tabId: string) => `ember.tab.track.${tabId}`;
const bpmKey = (tabId: string) => `ember.tab.bpm.${tabId}`;
/** The metronome override's bounds, as a tab's own tempo is kept. */
const MIN_BPM = 20;
const MAX_BPM = 400;

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A preference that cannot be remembered is not worth an error.
  }
}

/** The content column's width class, re-read on resize: the phone layout
 *  (and AlphaTab's smaller scale) below 640px. */
const PHONE_QUERY = '(max-width: 639px)';
function subscribeWidth(onChange: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
function usePhone(): boolean {
  return useSyncExternalStore(subscribeWidth, () => window.matchMedia(PHONE_QUERY).matches, () => false);
}

/** `/tabs/[trackId]`: the Sheet page approved on /dizajn
 *  (option A). Header, sticky toolbar, the score filling the
 *  content column, and the player bar left visible below, since the page
 *  has no transport of its own. */
export function TabsPage({ trackId }: { trackId: string }) {
  const router = useRouter();
  const player = usePlayer();
  const tabsEnabled = useSettingsStore((s) => s.tabsEnabled);
  const { song, loading: songLoading } = useTabSong(trackId, player.current);
  const sources = useTabSources(song);

  // The player moved on to another song while this page followed it.
  const currentId = player.current?.id ?? null;
  const prevCurrent = useRef(currentId);
  useEffect(() => {
    const next = followTrackChange(trackId, prevCurrent.current, currentId);
    prevCurrent.current = currentId;
    if (next) router.replace(next);
  }, [currentId, trackId, router]);

  const onBack = () => {
    if (window.history.length > 1) router.back();
    else router.push('/');
  };

  if (!tabsEnabled) {
    return (
      <EmptyState className="flex flex-col items-center gap-cluster">
        <p>Guitar tabs are turned off.</p>
        <Link href="/settings/plugins" className={buttonVariants({ variant: 'outline' })}>
          Settings &gt; Plugins
        </Link>
      </EmptyState>
    );
  }

  if (!song) {
    return (
      <EmptyState>
        {songLoading ? 'Loading…' : 'Ember does not know that song.'}
      </EmptyState>
    );
  }
  return <TabsSheet song={song} sources={sources} onBack={onBack} />;
}

function TabsSheet({ song, sources, onBack }: { song: TabSong; sources: TabSourcesState; onBack: () => void }) {
  const phone = usePhone();
  const { current, isPlaying, position, duration, seek, playTrack, rate, setRate, canSetRate } = usePlayer();
  const follows = current?.id === song.id;

  // Which tab is drawn: the listener's own pick for this song when they
  // made one, else the one that matches the recording best (lib/tabPick.ts).
  const [chosenId, setChosenId] = useState<string | null>(() => loadPick(song.id));
  const choice = chooseTab(sources.tabs, chosenId);
  const tab = choice.tab;
  const pick = (id: string | null) => {
    setChosenId(id);
    savePick(song.id, id);
  };
  const [sheetOpen, setSheetOpen] = useState(false);

  const [staff, setStaffState] = useState<TabsStaff>(() => readPref(STAFF_KEY, ['tab', 'score-tab'] as const, 'tab'));
  const [scroll, setScrollState] = useState<TabsScroll>(() =>
    readPref(SCROLL_KEY, ['vertical', 'horizontal'] as const, 'vertical'),
  );
  const setStaff = (s: TabsStaff) => {
    setStaffState(s);
    writePref(STAFF_KEY, s);
  };
  const setScroll = (s: TabsScroll) => {
    setScrollState(s);
    writePref(SCROLL_KEY, s);
  };

  // Where the tab sits in the recording: the
  // search that found it starts the job, this asks how it went.
  const align = useTabAlignment(tab);
  const timing = isLinedUp(align.timing) ? align.timing : null;

  // What the drawn score holds, kept with the tab it was read from: while
  // another tab is loading the old score's instruments are not this tab's,
  // and using them fills the picker with the wrong list and lets a track
  // index through that the new file has no instrument for.
  const [drawn, setDrawn] = useState<{ tabId: string; info: ScoreInfo } | null>(null);
  const info = tab && drawn?.tabId === tab.id ? drawn.info : null;
  const [trackChoice, setTrackChoice] = useState<{ tabId: string; index: number } | null>(null);
  const savedTrack = (tabId: string) => {
    try {
      const n = Number(window.localStorage.getItem(trackKey(tabId)));
      return Number.isInteger(n) && n >= 0 ? n : 0;
    } catch {
      return 0;
    }
  };
  const trackIndex = tab
    ? Math.min(
        trackChoice?.tabId === tab.id ? trackChoice.index : savedTrack(tab.id),
        Math.max(0, (info?.tracks.length ?? 1) - 1),
      )
    : 0;
  const setTrack = (index: number) => {
    if (!tab) return;
    setTrackChoice({ tabId: tab.id, index });
    writePref(trackKey(tab.id), String(index));
  };

  // The sync nudge: this device's own if it has one, else the tab's shared one.
  const [localOffset, setLocalOffset] = useState<{ id: string; ms: number | null } | null>(null);
  const offsetId = tab?.id ?? '';
  const local = localOffset?.id === offsetId ? localOffset.ms : tab ? loadLocalOffsetMs(offsetId) : null;
  const offsetMs = local ?? tab?.offsetMs ?? 0;
  const changeOffset = (ms: number | null) => {
    const v = ms === null ? null : clampOffset(ms);
    setLocalOffset({ id: offsetId, ms: v });
    saveLocalOffsetMs(offsetId, v);
  };
  const [syncOpen, setSyncOpen] = useState(false);
  const [offsetUnit, setOffsetUnitState] = useState<OffsetUnit>(() =>
    readPref(OFFSET_UNIT_KEY, ['seconds', 'beats'] as const, 'seconds'),
  );
  const setOffsetUnit = (u: OffsetUnit) => {
    setOffsetUnitState(u);
    writePref(OFFSET_UNIT_KEY, u);
  };
  // What a beat is for this tab (its opening tempo and time signature), for
  // a nudge counted in beats. Null until the score is drawn, or when the
  // file has no tempo.
  const beatClock = beatClockOf(info?.tempo, info?.signature);

  // The tab's bars and tempo map on its own clock (LiveTabScore reads them
  // out of AlphaTab), and the way between that clock and the song's: the
  // alignment's bar anchors when there is one, then the nudge.
  const [drawnTimeline, setDrawnTimeline] = useState<{ tabId: string; timeline: TabTimeline } | null>(null);
  const timeline = tab && drawnTimeline?.tabId === tab.id ? drawnTimeline.timeline : null;
  const points = useMemo(() => (timing && timeline ? syncPoints(timing, barStartsOf(timeline)) : []), [timing, timeline]);
  const toSongSec = (tabMs: number) => tabMsToSongSecAligned(tabMs, points, offsetMs);
  const toTabMs = (sec: number) => songSecToTabMs(sec, points, offsetMs);

  // The metronome (lib/metronome.ts): on the tab's own beats, following its
  // tempo changes, unless the listener set a tempo of their own because the
  // tab's is wrong (kept per tab on this device).
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [bpmChoice, setBpmChoice] = useState<{ tabId: string; bpm: number | null } | null>(null);
  const savedBpm = (tabId: string): number | null => {
    try {
      const n = Number(window.localStorage.getItem(bpmKey(tabId)));
      return n >= MIN_BPM && n <= MAX_BPM ? n : null;
    } catch {
      return null;
    }
  };
  const bpmOverride = tab ? (bpmChoice?.tabId === tab.id ? bpmChoice.bpm : savedBpm(tab.id)) : null;
  const setBpmOverride = (bpm: number | null) => {
    if (!tab) return;
    const v = bpm !== null && bpm >= MIN_BPM && bpm <= MAX_BPM ? Math.round(bpm * 10) / 10 : null;
    setBpmChoice({ tabId: tab.id, bpm: v });
    try {
      if (v === null) window.localStorage.removeItem(bpmKey(tab.id));
      else window.localStorage.setItem(bpmKey(tab.id), String(v));
    } catch {
      // Not remembering the tempo is not worth an error.
    }
  };
  const tabBpmNow = timeline ? bpmAtMs(timeline, toTabMs(position)) : (info?.tempo ?? null);
  const metronomeBeats = (fromSec: number, toSec: number): Click[] => {
    if (!timeline) return [];
    if (bpmOverride) {
      return steadyBeats(toSongSec(0), bpmOverride, timeline.bars[0]?.numerator ?? 4, fromSec, toSec);
    }
    return tabBeats(timeline, toTabMs(fromSec), toTabMs(toSec)).map((c) => ({ at: toSongSec(c.at), accent: c.accent }));
  };
  // ── practice: speed and loop (lib/tabPractice.ts) ───────────────────────
  // The speed is the page's while its song plays here: back to full speed
  // when the song changes or the page closes. Web audio only for now.
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (!follows || !canSetRate) return;
    setRate(speed);
    return () => setRate(1);
  }, [follows, canSetRate, speed, setRate]);
  const playRate = follows && canSetRate ? rate : 1;

  const [practiceOpen, setPracticeOpen] = useState(false);
  const [loop, setLoop] = useState<{ tabId: string; range: BarRange; on: boolean } | null>(null);
  const loopRange = tab && timeline && loop?.tabId === tab.id ? normalizeRange(loop.range, timeline) : null;
  const loopOn = !!loopRange && !!loop?.on;
  const setLoopRange = (range: BarRange | null, on = true) => {
    if (!tab) return;
    setLoop(range ? { tabId: tab.id, range, on } : null);
  };
  // Two clicks on the score choose the loop's bars.
  const [picking, setPicking] = useState<{ tabId: string; first: number | null } | null>(null);
  const pickingNow = tab && picking?.tabId === tab.id ? picking : null;
  const onBarPick = (bar: number) => {
    if (!tab) return;
    const next = pickBar(pickingNow?.first ?? null, bar);
    if (next.range) {
      setLoopRange(next.range, true);
      setPicking(null);
    } else {
      setPicking({ tabId: tab.id, first: next.picking });
    }
  };
  const loopMs = loopOn && timeline ? loopSpanMs(timeline, loopRange) : null;
  usePracticeLoop({
    span: loopMs ? { startSec: toSongSec(loopMs.startMs), endSec: toSongSec(loopMs.endMs) } : null,
    follows,
    running: follows && isPlaying,
    position,
    rate: playRate,
    seek,
  });

  useMetronome({
    on: metronomeOn && !!timeline,
    running: follows && isPlaying,
    position,
    rate: playRate,
    beats: metronomeBeats,
  });
  const toggleMetronome = () => {
    // The click's AudioContext is made on this gesture, as browsers ask.
    if (!metronomeOn) clickContext();
    setMetronomeOn((v) => !v);
  };

  const stickyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const meta = metaLine(song.artist, tab ? info : null, trackIndex);
  const addFile = () => fileRef.current?.click();
  // Links for the listener to open; Ember's own search is useTabSources'.
  const searchLinks = tabSearchLinks(song, sources.matches);
  const removeTab = (id: string) => {
    if (!window.confirm('Delete this tab for everyone?')) return;
    if (chosenId === id) pick(null);
    sources.remove(id);
  };

  // The Source sheet (candidate B): every tab
  // for the song in rank order, with what it is, how well it matched the
  // recording, and the actions that apply to it.
  const rows = sheetRows(sources.tabs, { chosenId, aligning: sources.liningUp });
  const sheetActions: TabSheetAction[] = [
    {
      id: 'search-again',
      label: sources.searchingOnline ? 'Searching online…' : 'Search online again',
      disabled: sources.searchingOnline,
      onClick: sources.searchOnlineAgain,
    },
    { id: 'add-file', label: sources.uploading ? 'Adding…' : 'Add a file', disabled: sources.uploading, onClick: addFile },
  ];

  const actions = (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Tab options"
        className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MoreIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={MENU_CLASS}>
        <MenuItem label="Add a Guitar Pro or MusicXML file" onClick={addFile} />
        <MenuItem
          label={sources.searchingOnline ? 'Searching online…' : 'Search online again'}
          disabled={sources.searchingOnline}
          onClick={sources.searchOnlineAgain}
        />
        {tab?.kind === 'fetched' && (
          <MenuItem
            label={align.running ? 'Lining it up…' : 'Line it up again'}
            disabled={align.running}
            onClick={align.lineUp}
          />
        )}
        <DropdownMenuSeparator />
        {searchLinks.map((l) => (
          <MenuItem key={l.id} label={l.menuLabel} onClick={() => openLink(l.url)} />
        ))}
        {tab?.canDelete && (
          <>
            <DropdownMenuSeparator />
            <MenuItem
              label="Delete this tab"
              className="text-destructive"
              onClick={() => removeTab(tab.id)}
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const chipNode = tab ? (
    <>
      <SourceChip
        tab={tab}
        instrument={info?.tracks[trackIndex]?.name}
        open={sheetOpen}
        onOpen={() => setSheetOpen((v) => !v)}
      />
      {tab.kind === 'fetched' && !timing && (
        <button
          type="button"
          data-testid="tab-line-up"
          disabled={align.running}
          onClick={align.lineUp}
          title={align.error ?? 'Listen to the recording and line the tab up with it'}
          className={cn(chip, align.running ? chipOff : chipOn)}
        >
          {align.running ? 'Lining it up…' : 'Line it up'}
        </button>
      )}
    </>
  ) : null;

  return (
    <div data-testid="tabs-page" data-track-id={song.id}>
      <input
        ref={fileRef}
        type="file"
        accept={TAB_ACCEPT}
        className="hidden"
        aria-label="Tab file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) sources.upload(file);
          e.target.value = '';
        }}
      />
      <TabSheetHeader phone={phone} title={song.title} meta={meta} chip={chipNode} actions={actions} onBack={onBack} />
      {sources.searchAgainResult && sources.searchAgainResult !== 'found' && (
        <p role="status" data-testid="tabs-online-status" className="text-meta mt-cluster">
          {sources.searchAgainResult === 'none'
            ? 'Nothing new found online.'
            : 'Could not search online just now. Try again later.'}
        </p>
      )}
      {(sources.uploading || sources.uploadError) && (
        <p role="status" className={cn('text-meta mt-cluster', sources.uploadError && 'text-destructive')}>
          {sources.uploadError ?? 'Adding the file…'}
        </p>
      )}

      {tab ? (
        <>
          <div
            ref={stickyRef}
            data-testid="tabs-sticky"
            className="sticky top-(--ember-topbar-h,0px) z-20 mt-block border-b border-border bg-background/95 py-cluster backdrop-blur"
          >
            <TabsToolbar
              phone={phone}
              staff={staff}
              scroll={scroll}
              tracks={info?.tracks ?? []}
              track={trackIndex}
              onStaffChange={setStaff}
              onScrollChange={setScroll}
              onTrackChange={setTrack}
            >
              <button
                type="button"
                aria-pressed={syncOpen}
                aria-label="Sync"
                onClick={() => setSyncOpen((v) => !v)}
                title="Nudge the tab if it runs ahead of or behind the recording"
                className={cn(chip, syncOpen || offsetMs !== 0 ? chipOn : chipOff)}
              >
                Sync
                <span className="tabular-nums font-normal">{formatOffset(offsetMs, offsetUnit, beatClock)}</span>
              </button>
              <button
                type="button"
                aria-pressed={practiceOpen}
                aria-label="Practice"
                onClick={() => setPracticeOpen((v) => !v)}
                title="Loop a section and slow it down"
                className={cn(chip, practiceOpen || loopOn || speed !== 1 ? chipOn : chipOff)}
              >
                <RepeatIcon className="size-3.5" />
                {!phone && 'Practice'}
                {speed !== 1 && canSetRate && <span className="tabular-nums font-normal">{Math.round(speed * 100)}%</span>}
                {loopOn && loopRange && <span className="font-normal">{rangeLabel(loopRange)}</span>}
              </button>
              <button
                type="button"
                aria-pressed={metronomeOn}
                aria-label="Metronome"
                disabled={!timeline}
                onClick={toggleMetronome}
                title={
                  timeline
                    ? 'Clicks on the beat, following the tab’s tempo'
                    : 'The metronome starts once the tab is drawn'
                }
                className={cn(chip, metronomeOn ? chipOn : chipOff, 'disabled:opacity-50')}
              >
                <ClockIcon className="size-3.5" />
                {!phone && 'Metronome'}
                {(bpmOverride ?? tabBpmNow) && (
                  <span className="tabular-nums font-normal">{Math.round(bpmOverride ?? tabBpmNow ?? 0)}</span>
                )}
              </button>
            </TabsToolbar>
            {syncOpen && (
              <SyncRow
                offsetMs={offsetMs}
                unit={offsetUnit}
                clock={beatClock}
                onUnitChange={setOffsetUnit}
                shared={tab.offsetMs}
                canShare={tab.canDelete}
                onChange={changeOffset}
                onShare={() => sources.saveOffset(tab.id, offsetMs).then(() => changeOffset(null))}
              />
            )}
            {practiceOpen && (
              <PracticeRow
                timeline={!!timeline}
                barTotal={timeline ? barCount(timeline) : 0}
                sections={timeline ? sectionRanges(timeline) : []}
                canSetRate={canSetRate}
                speed={speed}
                onSpeed={setSpeed}
                tabBpm={tabBpmNow}
                range={loopRange}
                loopOn={loopOn}
                onLoopOn={(on) => loopRange && setLoopRange(loopRange, on)}
                onRange={(r) => setLoopRange(r, loop?.on ?? true)}
                onClear={() => {
                  setLoopRange(null);
                  setPicking(null);
                }}
                picking={pickingNow ? (pickingNow.first === null ? 'first' : 'last') : null}
                onPick={() => (pickingNow ? setPicking(null) : tab && setPicking({ tabId: tab.id, first: null }))}
              />
            )}
            {metronomeOn && timeline && (
              <MetronomeRow
                tabBpm={tabBpmNow}
                steps={tempoSteps(timeline)}
                override={bpmOverride}
                onOverride={setBpmOverride}
              />
            )}
          </div>
          {!follows && (
            <div className="mt-block flex flex-wrap items-center gap-row rounded-lg bg-card px-block py-row text-sm text-muted-foreground">
              This song is not playing, so the tab stays still.
              {song.track && (
                <Button size="sm" variant="outline" onClick={() => playTrack(song.track!)}>
                  <PlayIcon className="size-3.5 fill-current" />
                  Play it
                </Button>
              )}
            </div>
          )}
          <LiveTabScore
            key={tab.downloadUrl}
            url={tab.downloadUrl}
            staff={staff}
            scroll={scroll}
            track={trackIndex}
            scale={scoreScale(phone)}
            offsetMs={offsetMs}
            timing={timing}
            follows={follows}
            playing={isPlaying}
            position={position}
            duration={duration}
            onSeek={seek}
            onScore={(next) => setDrawn({ tabId: tab.id, info: next })}
            onTimeline={(next) => setDrawnTimeline({ tabId: tab.id, timeline: next })}
            rate={playRate}
            highlight={loopOn || pickingNow ? loopRange : null}
            onBarPick={pickingNow ? onBarPick : null}
            getPageScroller={() => stickyRef.current?.closest<HTMLElement>('[data-app-scroller]') ?? null}
            getTopInset={() => {
              // The toolbar, plus the desktop top bar it sticks under
              // (`--ember-topbar-h`, 0 on a phone).
              const el = stickyRef.current;
              if (!el) return 0;
              const bar = parseFloat(getComputedStyle(el).getPropertyValue('--ember-topbar-h')) || 0;
              return el.getBoundingClientRect().height + bar;
            }}
            className="mt-block"
          />
        </>
      ) : (
        <NoTab sources={sources} searchLinks={searchLinks} phone={phone} onAddFile={addFile} />
      )}
      <TabSourceSheet
        open={sheetOpen}
        phone={phone}
        title={song.title}
        artist={song.artist}
        rows={rows}
        searching={sources.searchingOnline && rows.length === 0}
        emptyNote="Ember found nothing online for this song yet."
        onPick={(id) => {
          pick(id);
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
        onLineUp={sources.lineUp}
        onDelete={removeTab}
        actions={sheetActions}
      />
    </div>
  );
}

/** Open a link out of Ember: a new tab, or the system browser in the
 *  desktop app, where the webview drops new-tab links (lib/openExternal.ts). */
function openLink(url: string): void {
  void openExternal(url).then(announceOpen);
}

/** The tab page's menus never run off the screen: at most the
 *  viewport less a margin, whatever the trigger's width. */
const MENU_CLASS = 'w-max min-w-56 max-w-[calc(100vw-2rem)]';

/** One line of a menu: cut with an ellipsis when too long, whole in the
 *  tooltip. */
function MenuItem({
  label,
  onClick,
  disabled,
  className,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <DropdownMenuItem title={label} disabled={disabled} onClick={onClick} className={cn('min-w-0', className)}>
      <span className="min-w-0 truncate">{label}</span>
    </DropdownMenuItem>
  );
}

/** "File added by Aron, shared", "Text tab pasted by Aron, shared" or
 *  "From Songsterr, Rhythm Guitar, lined up", with how sure the alignment
 *  is when there is one. Clicking it opens the Source sheet: every tab for
 *  the song. */
function SourceChip({
  tab,
  instrument,
  open,
  onOpen,
}: {
  tab: TabSummary;
  /** The staff on screen, named on the chip of a tab that holds several. */
  instrument?: string;
  open: boolean;
  onOpen: () => void;
}) {
  const label = sourceChipLabel(tab, instrument);
  const pct = isLinedUp(tab.timing) ? confidencePercent(tab) : null;
  return (
    <TabSourceChip label={label}>
      <button
        type="button"
        aria-label="Choose a tab"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onOpen}
        title={label}
        className="inline-flex min-w-0 max-w-full items-center gap-inset hover:text-foreground"
      >
        <span className="min-w-0 truncate">{label}</span>
        {pct !== null && <span className="shrink-0 tabular-nums text-ember">{pct}%</span>}
        <ChevronDownIcon className="size-3 shrink-0" />
      </button>
    </TabSourceChip>
  );
}

/** The nudge: slide the tab against the recording. Kept on this device;
 *  whoever added the tab can save it for everyone. A slider for the rough
 *  place, steps and a box for the exact one, in seconds or in beats of the
 *  tab (its tempo and time signature, lib/tabOffset.ts). */
function SyncRow({
  offsetMs,
  unit,
  clock,
  onUnitChange,
  shared,
  canShare,
  onChange,
  onShare,
}: {
  offsetMs: number;
  unit: OffsetUnit;
  clock: BeatClock | null;
  onUnitChange: (unit: OffsetUnit) => void;
  shared: number;
  canShare: boolean;
  onChange: (ms: number | null) => void;
  onShare: () => void;
}) {
  const shown: OffsetUnit = unit === 'beats' && clock ? 'beats' : 'seconds';
  const span = sliderSpanSec(offsetMs);
  const value = offsetInUnit(offsetMs, shown, clock);
  // The box keeps what is being typed ("-", "1.") until it reads as a
  // number; it shows the nudge again whenever the nudge changes elsewhere.
  const [draft, setDraft] = useState<{ text: string; for: string } | null>(null);
  const key = `${offsetMs}|${shown}`;
  const text = draft && draft.for === key ? draft.text : String(value);
  const commit = (raw: string) => {
    const ms = offsetFromInput(raw, shown, clock);
    setDraft({ text: raw, for: ms === null ? key : `${clampOffset(ms)}|${shown}` });
    if (ms !== null && ms !== offsetMs) onChange(ms);
  };
  return (
    <div data-testid="tab-sync" className="mt-cluster flex flex-col gap-cluster text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-row">
        <input
          type="range"
          min={-span}
          max={span}
          step={0.01}
          value={offsetMs / 1000}
          onChange={(e) => onChange(Number(e.target.value) * 1000)}
          className="min-w-40 flex-1 accent-ember"
          aria-label="Tab timing offset in seconds"
        />
        <div className="flex shrink-0 items-center gap-inset">
          <input
            type="number"
            inputMode="decimal"
            step={shown === 'beats' ? 0.25 : 0.01}
            value={text}
            onChange={(e) => commit(e.target.value)}
            className="h-7 w-24 rounded-md border border-border bg-background px-cluster text-right text-xs tabular-nums text-foreground"
            aria-label={shown === 'beats' ? 'Tab timing offset in beats' : 'Tab timing offset, exact seconds'}
          />
          <div className="flex items-center rounded-full bg-muted p-inset" role="group" aria-label="Offset unit">
            {(['seconds', 'beats'] as const).map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={shown === u}
                disabled={u === 'beats' && !clock}
                title={u === 'beats' && !clock ? 'This tab has no tempo to count beats by' : undefined}
                onClick={() => onUnitChange(u)}
                className={cn(
                  'rounded-full px-row py-inset text-xs font-medium transition-colors disabled:opacity-40',
                  shown === u ? 'bg-background text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {u === 'seconds' ? 's' : 'beats'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-inset">
        {nudgeSteps(shown, clock).map((s) => (
          <Button key={s.label} size="sm" variant="ghost" className="tabular-nums" onClick={() => onChange(clampOffset(offsetMs + s.ms))}>
            {s.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => onChange(0)}>
          Reset
        </Button>
        {canShare && offsetMs !== shared && (
          <Button size="sm" variant="outline" onClick={onShare}>
            Save for everyone
          </Button>
        )}
        {shown === 'beats' && clock && (
          <span className="tabular-nums" data-testid="tab-sync-beat">
            1 beat = {Math.round((60_000 / clock.bpm) * (4 / clock.denominator))} ms at {Math.round(clock.bpm)} bpm, {clock.numerator}/{clock.denominator}
          </span>
        )}
      </div>
    </div>
  );
}

/** Practice: the speed (pitch kept) and a loop over a section or a range
 *  of bars (lib/tabPractice.ts). */
function PracticeRow({
  timeline,
  barTotal,
  sections,
  canSetRate,
  speed,
  onSpeed,
  tabBpm,
  range,
  loopOn,
  onLoopOn,
  onRange,
  onClear,
  picking,
  onPick,
}: {
  /** The score is drawn, so its bars are known. */
  timeline: boolean;
  barTotal: number;
  sections: SectionRange[];
  canSetRate: boolean;
  speed: number;
  onSpeed: (rate: number) => void;
  /** The tab's tempo at the playhead. */
  tabBpm: number | null;
  range: BarRange | null;
  loopOn: boolean;
  onLoopOn: (on: boolean) => void;
  onRange: (range: BarRange) => void;
  onClear: () => void;
  /** Choosing bars on the score: the next click is the first or the last. */
  picking: 'first' | 'last' | null;
  onPick: () => void;
}) {
  const percent = Math.round(speed * 100);
  const heard = bpmAtRate(tabBpm, speed);
  const [bpmDraft, setBpmDraft] = useState<string | null>(null);
  const [percentDraft, setPercentDraft] = useState<string | null>(null);
  const sectionValue = range ? sections.findIndex((x) => x.start === range.start && x.end === range.end) : -1;
  const barInput = (label: string, value: number | undefined, set: (bar: number) => void) => (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      max={Math.max(1, barTotal)}
      step={1}
      value={value === undefined ? '' : value + 1}
      disabled={!timeline}
      onChange={(e) => {
        const n = Math.round(Number(e.target.value));
        if (Number.isFinite(n) && n >= 1) set(n - 1);
      }}
      className="h-7 w-16 rounded-md border border-border bg-background px-cluster text-right text-xs tabular-nums text-foreground disabled:opacity-50"
      aria-label={label}
    />
  );
  return (
    <div data-testid="tab-practice" className="mt-cluster flex flex-col gap-cluster text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-row" role="group" aria-label="Speed">
        <span className="font-medium text-foreground">Speed</span>
        {canSetRate ? (
          <>
            <div className="flex flex-wrap items-center gap-inset">
              {SPEED_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={percent === p}
                  onClick={() => {
                    setPercentDraft(null);
                    setBpmDraft(null);
                    onSpeed(rateFromPercent(p));
                  }}
                  className={cn(chip, percent === p ? chipOn : chipOff, 'tabular-nums')}
                >
                  {p}%
                </button>
              ))}
            </div>
            <label className="flex items-center gap-inset">
              <input
                type="number"
                inputMode="numeric"
                min={50}
                max={125}
                step={5}
                value={percentDraft ?? String(percent)}
                onChange={(e) => {
                  setPercentDraft(e.target.value);
                  setBpmDraft(null);
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 50 && n <= 125) onSpeed(rateFromPercent(n));
                }}
                onBlur={() => setPercentDraft(null)}
                className="h-7 w-16 rounded-md border border-border bg-background px-cluster text-right text-xs tabular-nums text-foreground"
                aria-label="Speed in percent"
              />
              <span>%</span>
            </label>
            {tabBpm ? (
              <label className="flex items-center gap-inset">
                <span>=</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={bpmDraft ?? String(heard ?? '')}
                  onChange={(e) => {
                    setBpmDraft(e.target.value);
                    setPercentDraft(null);
                    const r = rateFromBpm(Number(e.target.value), tabBpm);
                    if (r !== null) onSpeed(r);
                  }}
                  onBlur={() => setBpmDraft(null)}
                  className="h-7 w-16 rounded-md border border-border bg-background px-cluster text-right text-xs tabular-nums text-foreground"
                  aria-label="Speed in bpm"
                />
                <span>bpm (the tab: {Math.round(tabBpm)})</span>
              </label>
            ) : null}
          </>
        ) : (
          <span data-testid="tab-speed-unavailable">
            Slowing down works in the browser for now; this app plays at full speed.
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-row" role="group" aria-label="Loop">
        <button
          type="button"
          aria-pressed={loopOn}
          aria-label="Loop"
          disabled={!range}
          onClick={() => onLoopOn(!loopOn)}
          title={range ? `Loop ${rangeLabel(range).toLowerCase()}` : 'Choose bars or a section to loop first'}
          className={cn(chip, loopOn ? chipOn : chipOff, 'disabled:opacity-50')}
        >
          <RepeatIcon className="size-3.5" />
          Loop
        </button>
        {sections.length > 0 && (
          <select
            aria-label="Loop a section"
            value={sectionValue >= 0 ? String(sectionValue) : ''}
            onChange={(e) => {
              const sct = sections[Number(e.target.value)];
              if (sct) onRange({ start: sct.start, end: sct.end });
            }}
            className="h-7 rounded-md border border-border bg-background px-cluster text-xs text-foreground"
          >
            <option value="">Section…</option>
            {sections.map((sct, i) => (
              <option key={`${sct.start}:${sct.name}`} value={String(i)}>
                {sct.name} ({rangeLabel(sct).toLowerCase()})
              </option>
            ))}
          </select>
        )}
        <span className="flex items-center gap-inset">
          <span>Bars</span>
          {barInput('Loop from bar', range?.start, (b) => onRange({ start: b, end: Math.max(b, range?.end ?? b) }))}
          <span>to</span>
          {barInput('Loop to bar', range?.end, (b) => onRange({ start: Math.min(b, range?.start ?? b), end: b }))}
          {barTotal > 0 && <span>of {barTotal}</span>}
        </span>
        <Button size="sm" variant={picking ? 'outline' : 'ghost'} disabled={!timeline} onClick={onPick}>
          {picking ? 'Cancel picking' : 'Pick on the tab'}
        </Button>
        {range && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        )}
        {picking && (
          <span role="status" data-testid="tab-loop-picking" className="text-ember">
            {picking === 'first' ? 'Click the first bar of the loop.' : 'Now click its last bar.'}
          </span>
        )}
      </div>
    </div>
  );
}

/** The metronome's tempo: the tab's (which changes where the tab does), or
 *  one the listener sets because the tab's is wrong. */
function MetronomeRow({
  tabBpm,
  steps,
  override,
  onOverride,
}: {
  /** The tab's tempo at the playhead. */
  tabBpm: number | null;
  /** Every tempo the tab plays at, in order. */
  steps: number[];
  override: number | null;
  onOverride: (bpm: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (override !== null ? String(override) : '');
  const tabText = tabBpm ? `${Math.round(tabBpm)} bpm` : 'no tempo';
  return (
    <div data-testid="tab-metronome" className="mt-cluster flex flex-wrap items-center gap-row text-xs text-muted-foreground">
      <span data-testid="tab-metronome-status">
        {override !== null
          ? `Clicking at ${override} bpm; the tab says ${tabText} here.`
          : `Follows the tab: ${tabText} here${steps.length > 1 ? ` (tempo changes ${steps.join(' → ')})` : ''}.`}
      </span>
      <label className="flex items-center gap-inset">
        <span>Set bpm</span>
        <input
          type="number"
          inputMode="decimal"
          min={MIN_BPM}
          max={MAX_BPM}
          step={1}
          value={shown}
          placeholder={tabBpm ? String(Math.round(tabBpm)) : ''}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            const n = Number(raw);
            if (raw.trim() === '') onOverride(null);
            else if (Number.isFinite(n) && n >= MIN_BPM && n <= MAX_BPM) onOverride(n);
          }}
          onBlur={() => setDraft(null)}
          className="h-7 w-20 rounded-md border border-border bg-background px-cluster text-right text-xs tabular-nums text-foreground"
          aria-label="Metronome bpm"
        />
      </label>
      {override !== null && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft(null);
            onOverride(null);
          }}
        >
          Use the tab’s tempo
        </Button>
      )}
    </div>
  );
}

/** What each place to look by hand holds, under its name in the list. */
const SITE_NOTES: Record<TabSearchLink['id'], string> = {
  'ultimate-guitar': 'Text and Guitar Pro tabs, rated by players',
  'guitar-pro': 'A web search for .gp and .gpx files',
  songsterr: 'Search Songsterr yourself',
};

const FILE_NOTE = 'A Guitar Pro or MusicXML tab. Everyone here gets it.';

/** "Guitar, Bass, Drums, chords": what a Songsterr version holds. */
function matchInstruments(m: TabMatch): string {
  return [m.instruments.join(', '), m.hasChords ? 'chords' : ''].filter(Boolean).join(', ');
}

/** The card's heading and the line under it, per state. */
function emptyHead(state: EmptyStateView): { title: string; sub: string } {
  if (state.kind === 'searching') return { title: 'Looking on Songsterr…', sub: 'This takes a few seconds.' };
  if (state.kind === 'none') return { title: 'Nothing on Songsterr', sub: 'Try the places people post tabs, then add the file here.' };
  const n = state.matches.length;
  return n === 1
    ? {
        title: '1 tab on Songsterr',
        sub: 'Ember could not draw it here. Open it on Songsterr, or get its Guitar Pro file and add it below.',
      }
    : {
        title: `${n} tabs on Songsterr`,
        sub: 'Ember could not draw these here. Open one on Songsterr, or get its Guitar Pro file and add it below.',
      };
}

type EmptyStateView = ReturnType<typeof emptyStateFor>;

/** A link out of Ember that opens through lib/openExternal (the desktop
 *  app drops plain new-tab links). */
function OutLink({ href, className, children, ...rest }: ComponentProps<'a'>) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.preventDefault();
        if (href) openLink(href);
      }}
      className={className}
      {...rest}
    >
      {children}
    </a>
  );
}

/** The end of a row: "Open"/"Search" on a wide screen, a chevron on a phone. */
function RowEnd({ phone, label }: { phone: boolean; label: string }) {
  return phone ? (
    <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
  ) : (
    <span className={cn(chip, chipOff, 'group-hover:bg-background group-hover:text-foreground')}>{label}</span>
  );
}

const ROW = 'group flex min-w-0 items-center gap-row px-block py-row transition-colors hover:bg-muted/60';

/** One Songsterr version: the tab icon, its title, what it holds, Open. */
function MatchRow({ match, best, phone }: { match: TabMatch; best: boolean; phone: boolean }) {
  return (
    <li>
      <OutLink href={match.url} data-testid="tabs-empty-match" className={ROW}>
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-ember/15 text-ember">
          <TabsIcon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-cluster">
            <span title={match.title} className="min-w-0 truncate text-sm font-medium">
              {match.title}
            </span>
            {best && (
              <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-ember/15 px-cluster py-inset text-[11px] font-medium leading-none text-ember">
                Best match
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{matchInstruments(match)}</span>
        </span>
        <RowEnd phone={phone} label="Open" />
      </OutLink>
    </li>
  );
}

/** A place to look by hand, drawn like a Songsterr row. */
function SiteRow({ link, phone }: { link: TabSearchLink; phone: boolean }) {
  return (
    <li>
      <OutLink href={link.url} data-testid="tabs-empty-site" data-link={link.id} className={ROW}>
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <SearchIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{link.label}</span>
          <span className="block truncate text-xs text-muted-foreground">{SITE_NOTES[link.id]}</span>
        </span>
        <RowEnd phone={phone} label="Search" />
      </OutLink>
    </li>
  );
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <li key={i} aria-hidden className="flex items-center gap-row px-block py-row">
          <Skeleton className="size-10 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-inset">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </li>
      ))}
    </>
  );
}

/** No tab to draw (the "Songsterr list" the owner picked): Songsterr's
 *  versions of the song to open there, or the places people post tabs when
 *  Songsterr has none, with Add a file below either. While Ember is still
 *  asking, the list is a skeleton. */
function NoTab({
  sources,
  searchLinks,
  phone,
  onAddFile,
}: {
  sources: TabSourcesState;
  searchLinks: TabSearchLink[];
  phone: boolean;
  onAddFile: () => void;
}) {
  const state = emptyStateFor({
    loading: sources.loading,
    searchingOnline: sources.searchingOnline,
    matchesLoading: sources.matchesLoading,
    matches: sources.matches,
  });
  const head = emptyHead(state);
  // Ultimate Guitar and Guitar Pro files: Songsterr has its own rows.
  const otherSites = searchLinks.filter((l) => l.id !== 'songsterr');
  const searching = state.kind === 'searching';
  return (
    <div data-testid="tabs-empty" data-state={state.kind} className="mt-stack flex max-w-2xl flex-col gap-stack">
      <section className="overflow-hidden rounded-2xl border border-border bg-card/60">
        <header className="px-block pb-row pt-block">
          <h2
            role={searching ? 'status' : undefined}
            data-testid={searching ? 'tabs-searching' : undefined}
            className="text-lg font-semibold"
          >
            {head.title}
          </h2>
          <p className="text-meta mt-inset">{head.sub}</p>
        </header>
        <ul data-testid="tabs-empty-list" aria-busy={searching || undefined} className="divide-y divide-border border-t border-border">
          {state.kind === 'matches' &&
            state.matches.map((m, i) => <MatchRow key={m.id} match={m} best={i === 0 && state.matches.length > 1} phone={phone} />)}
          {state.kind === 'none' && otherSites.map((l) => <SiteRow key={l.id} link={l} phone={phone} />)}
          {searching && <SkeletonRows />}
        </ul>
      </section>
      <div className="flex flex-wrap items-center gap-x-block gap-y-cluster">
        <Button variant="ember" onClick={onAddFile} disabled={sources.uploading}>
          <UploadIcon className="size-4" />
          {sources.uploading ? 'Adding…' : 'Add a file'}
        </Button>
        <p className="text-meta min-w-0 flex-1 basis-56">{FILE_NOTE}</p>
      </div>
      {state.kind !== 'none' && otherSites.length > 0 && (
        <p data-testid="tab-search-links" className="text-meta">
          Not the version you want? Search{' '}
          {otherSites.map((l, i) => (
            <span key={l.id}>
              {i > 0 && ' or '}
              <OutLink
                href={l.url}
                data-link={l.id}
                className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
              >
                {l.label}
              </OutLink>
            </span>
          ))}
          .
        </p>
      )}
    </div>
  );
}
