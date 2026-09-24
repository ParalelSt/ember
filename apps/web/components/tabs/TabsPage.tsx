'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
import { ChevronDownIcon, ClockIcon, MoreIcon, PlayIcon } from '@/components/icons';
import { EmptyState } from '@/components/page/EmptyState';
import { usePlayer } from '@/components/player/PlayerProvider';
import { LiveTabScore } from '@/components/tabs/LiveTabScore';
import { TabSheetHeader, TabSourceChip } from '@/components/tabs/TabSheetHeader';
import { TabSourceSheet, type TabSheetAction } from '@/components/tabs/TabSourceSheet';
import { TabsToolbar, chip, chipOff, chipOn } from '@/components/tabs/TabsToolbar';
import { useTabAlignment, useTabSong, useTabSources, type TabSong, type TabSourcesState } from '@/hooks/useTabSources';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { cn } from '@/lib/utils';
import { metaLine, scoreScale, type ScoreInfo, type TabsScroll, type TabsStaff } from '@/lib/tabScore';
import {
  emptyStateFor,
  followTrackChange,
  localOffsetId,
  sourceChipLabel,
  type TabSummary,
} from '@/lib/tabSources';
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
import { TOOLS_MISSING_SHORT } from '@/lib/tabToolsText';

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

/** `/tabs/[trackId]`: the Sheet page approved on /dizajn (docs/tabs-rebuild.md
 *  section 6, option A). Header, sticky toolbar, the score filling the
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
  const { current, isPlaying, position, duration, seek, playTrack } = usePlayer();
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

  // Where the tab sits in the recording (docs/tabs-v3.md section 3): the
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
  const offsetId = tab ? localOffsetId(tab) : '';
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
  useMetronome({
    on: metronomeOn && !!timeline,
    running: follows && isPlaying,
    position,
    rate: 1,
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
  const ownGenerated = sources.tabs.some((t) => t.kind === 'generated' && t.trackId === song.id);
  const busyGenerating = sources.generated === 'running' || sources.generating;
  // Links for the listener to open; Ember's own search is useTabSources'.
  const searchLinks = tabSearchLinks(song, sources.matches);
  const removeTab = (id: string) => {
    if (!window.confirm('Delete this tab for everyone?')) return;
    if (chosenId === id) pick(null);
    sources.remove(id);
  };

  // The Source sheet (docs/tabs-v3.md section 6, candidate B): every tab
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
    ...(sources.canGenerate && !ownGenerated
      ? [
          {
            id: 'generate',
            label: busyGenerating
              ? 'Transcribing…'
              : sources.generateUnavailable
                ? `Generate a tab: ${TOOLS_MISSING_SHORT.toLowerCase()}`
                : 'Generate a tab (rough)',
            disabled: busyGenerating || !!sources.generateUnavailable,
            variant: 'ghost' as const,
            onClick: sources.generate,
          },
        ]
      : []),
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
        {sources.canGenerate && !ownGenerated && (
          <MenuItem
            label={
              busyGenerating
                ? 'Transcribing…'
                : sources.generateUnavailable
                  ? `Generate a tab: ${TOOLS_MISSING_SHORT.toLowerCase()}`
                  : 'Generate a tab from the recording'
            }
            disabled={busyGenerating || !!sources.generateUnavailable}
            onClick={sources.generate}
          />
        )}
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
          <MenuItem key={l.id} label={l.menuLabel} onClick={() => window.open(l.url, '_blank', 'noopener,noreferrer')} />
        ))}
        {tab?.canDelete && !tab.id.startsWith('generated:') && (
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
                canShare={tab.canDelete && !tab.id.startsWith('generated:')}
                onChange={changeOffset}
                onShare={() => sources.saveOffset(tab.id, offsetMs).then(() => changeOffset(null))}
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
        <NoTab sources={sources} searchLinks={searchLinks} onAddFile={addFile} />
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

/** The tab page's menus never run off the screen (docs/tabs-v3.md section
 *  5): at most the viewport less a margin, whatever the trigger's width. */
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

/** "File added by Aron, shared", "Text tab pasted by Aron, shared", "From
 *  Songsterr, Rhythm Guitar, lined up" or "Generated from the recording,
 *  rough", with how sure the alignment is when there is one. Clicking it
 *  opens the Source sheet: every tab for the song. */
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

/** No tab to draw: search for one by hand, add a file, or (the last resort)
 *  generate a rough one from the recording. */
function NoTab({
  sources,
  searchLinks,
  onAddFile,
}: {
  sources: TabSourcesState;
  searchLinks: TabSearchLink[];
  onAddFile: () => void;
}) {
  const state = emptyStateFor({
    loading: sources.loading,
    generated: sources.generated,
    generating: sources.generating,
    generateError: sources.generatedError,
    startError: sources.generateError,
    generateUnavailable: sources.generateUnavailable,
    canGenerate: sources.canGenerate,
    matches: sources.matches,
    searchingOnline: sources.searchingOnline,
  });
  if (state.kind === 'loading') return <EmptyState>Looking for a tab…</EmptyState>;
  if (state.kind === 'searching') {
    return (
      <EmptyState>
        <span role="status" data-testid="tabs-searching">
          Finding a tab online…
        </span>
      </EmptyState>
    );
  }
  if (state.kind === 'generating') {
    return (
      <EmptyState>
        <span role="status">Transcribing the recording… this takes a few minutes.</span>
      </EmptyState>
    );
  }
  return (
    <div data-testid="tabs-empty" className="mt-section flex flex-col items-center gap-block text-center">
      <p className="text-muted-foreground">No tab for this song yet.</p>
      <div className="flex flex-col items-center gap-cluster">
        <div className="text-eyebrow">Find one</div>
        <div data-testid="tab-search-links" className="flex flex-wrap justify-center gap-cluster">
          {searchLinks.map((l) => (
            <a
              key={l.id}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              data-link={l.id}
              className={cn(chip, chipOff)}
            >
              {l.label}
            </a>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-cluster">
        <Button variant="outline" onClick={onAddFile} disabled={sources.uploading}>
          {sources.uploading ? 'Adding…' : 'Add a file'}
        </Button>
        {state.canGenerate && (
          <Button
            variant="ghost"
            onClick={sources.generate}
            disabled={!!state.unavailable}
            title={state.unavailable ?? undefined}
            aria-describedby={state.unavailable ? 'tabs-generate-unavailable' : undefined}
          >
            Generate a tab (rough)
          </Button>
        )}
      </div>
      <p className="text-meta max-w-md">
        {state.canGenerate && !state.unavailable
          ? 'A file is a Guitar Pro or MusicXML tab, shared with everyone here. Generating listens to the recording and writes a guitar tab: a few minutes, rough in places, so it is the last resort.'
          : 'A file is a Guitar Pro or MusicXML tab, shared with everyone here.'}
      </p>
      {state.unavailable && (
        <p id="tabs-generate-unavailable" data-testid="tabs-generate-unavailable" role="note" className="text-meta max-w-md">
          {state.unavailable}
        </p>
      )}
      {state.failed && <p className="text-sm text-destructive">{state.failed}</p>}
      {state.songsterr.length > 0 && (
        <div className="mt-block w-full max-w-md text-left">
          <div className="text-eyebrow mb-cluster">On Songsterr</div>
          <div className="flex flex-col gap-inset">
            {state.songsterr.map((m) => (
              <a
                key={m.id}
                href={m.url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-row rounded-md px-row py-cluster transition-colors hover:bg-card"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{m.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {m.artist}
                    {m.instruments.length > 0 && ` · ${m.instruments.join(', ')}`}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">Opens Songsterr</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
