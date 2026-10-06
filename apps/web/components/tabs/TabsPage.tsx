'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
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
  MoreIcon,
  PlayIcon,
  RepeatIcon,
} from '@/components/icons';
import { EmptyState } from '@/components/page/EmptyState';
import { usePlayer } from '@/components/player/PlayerProvider';
import { LiveTabScore } from '@/components/tabs/LiveTabScore';
import { TabSheetHeader } from '@/components/tabs/TabSheetHeader';
import { NoTab, openLink } from '@/components/tabs/TabEmpty';
import { InstrumentIcon, TabSourceSheet, type TabSheetAction } from '@/components/tabs/TabSourceSheet';
import { chip, chipOff, chipOn } from '@/components/tabs/chips';
import { PlayPill, StageHeader } from '@/components/tabs/TabStage';
import {
  ClickEditor,
  CountInEditor,
  DelayEditor,
  LoopEditor,
  MAX_BPM,
  MIN_BPM,
  PracticeToolbar,
  SpeedEditor,
  ToolPopover,
} from '@/components/tabs/PracticeTools';
import { useCountIn } from '@/hooks/useCountIn';
import {
  barPosition,
  countInFrom,
  countInPlan,
  nextSlower,
  stageMeta,
  toolCells,
  type CountInBars,
  type ToolId,
} from '@/lib/tabStage';
import { useTabAlignment, useTabSong, useTabSources, type TabSong, type TabSourcesState } from '@/hooks/useTabSources';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { cn } from '@/lib/utils';
import { metaLine, scoreScale, type ScoreInfo, type TabsScroll, type TabsStaff } from '@/lib/tabScore';
import { followTrackChange, sourceChipLabel } from '@/lib/tabSources';
import { chooseTab, confidencePercent, loadPick, savePick } from '@/lib/tabPick';
import { instrumentChoices, instrumentKey, tabParts, versionLabel, versionsFor } from '@/lib/tabChoose';
import {
  clampOffset,
  isLinedUp,
  loadLocalOffsetMs,
  saveLocalOffsetMs,
  songSecToTabMs,
  syncPoints,
  tabMsToSongSecAligned,
} from '@/lib/tabSync';
import { barAtMs, barStartsOf, bpmAtMs, steadyBeats, tabBeats, tempoSteps, type Click, type TabTimeline } from '@/lib/tabTimeline';
import { clickContext } from '@/lib/metronome';
import { useMetronome } from '@/hooks/useMetronome';
import { usePracticeLoop } from '@/hooks/usePracticeLoop';
import {
  barCount,
  loopSpanMs,
  normalizeRange,
  pickBar,
  rangeLabel,
  rateFromPercent,
  sectionRanges,
  type BarRange,
} from '@/lib/tabPractice';
import { beatClockOf, formatOffset, type OffsetUnit } from '@/lib/tabOffset';
import { tabSearchLinks } from '@/lib/tabSearchLinks';
import { leavePage } from '@/lib/inAppHistory';

const TAB_ACCEPT = '.gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.xml,.mxl';
const STAFF_KEY = 'ember.tabs.staff';
const SCROLL_KEY = 'ember.tabs.scroll';
const OFFSET_UNIT_KEY = 'ember.tabs.offsetUnit';
const trackKey = (tabId: string) => `ember.tab.track.${tabId}`;
const bpmKey = (tabId: string) => `ember.tab.bpm.${tabId}`;
const COUNT_IN_KEY = 'ember.tabs.countIn';
const TOOLS_KEY = 'ember.tabs.tools';

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
  // The song the page is on its way to: a second skip that comes before the
  // first move lands still finds the page following (it is going to the
  // song that just ended), instead of judging it by the old address and
  // leaving it stuck on a tab that is no longer playing.
  const headingTo = useRef<string | null>(null);
  useEffect(() => {
    if (headingTo.current === trackId) headingTo.current = null;
    const next = followTrackChange(headingTo.current ?? trackId, prevCurrent.current, currentId);
    prevCurrent.current = currentId;
    if (next && currentId) {
      headingTo.current = currentId;
      router.replace(next);
    }
  }, [currentId, trackId, router]);

  // Back to the page before when it was Ember's, else home: the same as a
  // second click on the player bar's tabs button (lib/inAppHistory).
  const onBack = () => leavePage(router);

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
  const { current, isPlaying, position, duration, seek, playTrack, toggle, rate, setRate, canSetRate } = usePlayer();
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
  // Kept inside the drawn score's tracks; before the score is read, the
  // choice stands (a version picked for its second instrument), and the
  // score keeps it inside the file (lib/tabScore.ts trackIndexIn).
  const trackIndex = tab
    ? Math.min(
        trackChoice?.tabId === tab.id ? trackChoice.index : savedTrack(tab.id),
        info ? Math.max(0, info.tracks.length - 1) : Number.MAX_SAFE_INTEGER,
      )
    : 0;

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

  // The count-in before Play on the pill starts the song (lib/tabStage.ts),
  // remembered on this device.
  const [countInBars, setCountInState] = useState<CountInBars>(() => {
    try {
      return countInFrom(window.localStorage.getItem(COUNT_IN_KEY));
    } catch {
      return 1;
    }
  });
  const setCountIn = (n: CountInBars) => {
    setCountInState(n);
    writePref(COUNT_IN_KEY, String(n));
  };
  const countIn = useCountIn();
  // The count ends after a few seconds: by then the listener may have
  // started the song from the player bar, and a toggle would pause it.
  const playingNow = useRef(isPlaying);
  useLayoutEffect(() => {
    playingNow.current = isPlaying;
  });

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

  // Choosing a tab, instrument first (lib/tabChoose.ts): the parts the
  // song's tabs hold (the drawn score's own track names for the tab on
  // screen), and the versions of the one shown, best match first.
  const rankOpts = { chosenId, aligning: sources.liningUp };
  const drawnParts = tab && info ? { tabId: tab.id, tracks: info.tracks.map((t) => ({ name: t.name, instrument: t.instrument })) } : null;
  const parts = tab ? tabParts(tab, drawnParts) : [];
  const currentPart = parts[Math.min(trackIndex, parts.length - 1)] ?? null;
  const instruments = instrumentChoices(sources.tabs, drawnParts, rankOpts);
  const currentVersions = currentPart ? versionsFor(sources.tabs, currentPart, drawnParts, rankOpts) : [];
  // The instrument the sheet lists: the one tapped there, else the one
  // shown.
  const [sheetInstrument, setSheetInstrument] = useState<string | null>(null);
  const wanted = sheetInstrument ?? (currentPart ? instrumentKey(currentPart) : null);
  const listed = instruments.find((i) => i.key === wanted)?.key ?? instruments[0]?.key ?? null;
  const versions = listed ? versionsFor(sources.tabs, listed, drawnParts, rankOpts) : [];
  const openSheet = () => {
    setSheetInstrument(null);
    setSheetOpen((v) => !v);
  };
  const choose = (id: string, track: number) => {
    pick(id);
    setTrackChoice({ tabId: id, index: track });
    writePref(trackKey(id), String(track));
    setSheetOpen(false);
  };
  const sheetActions: TabSheetAction[] = [
    {
      id: 'search-again',
      label: sources.searchingOnline ? 'Searching online…' : 'Search online again',
      disabled: sources.searchingOnline,
      onClick: sources.searchOnlineAgain,
    },
    { id: 'add-file', label: sources.uploading ? 'Adding…' : 'Add a file', disabled: sources.uploading, onClick: addFile },
  ];

  // The practice toolbar (lib/tabStage.ts toolCells): over the tab on a
  // wide screen; on a phone a strip above the pill that its sliders button
  // shows and hides (remembered). One popover at a time.
  const [toolsShown, setToolsShown] = useState(() => readPref(TOOLS_KEY, ['open', 'closed'] as const, 'closed') === 'open');
  const toolsOpen = !phone || toolsShown;
  const setToolsOpen = (open: boolean) => {
    setToolsShown(open);
    writePref(TOOLS_KEY, open ? 'open' : 'closed');
  };
  const [openTool, setOpenTool] = useState<ToolId | null>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  // A tap or click anywhere else closes the popover (the pill is left out:
  // its loop button opens one).
  useEffect(() => {
    if (!openTool) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (toolsRef.current?.contains(t) || pillRef.current?.contains(t))) return;
      setOpenTool(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenTool(null);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [openTool]);

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
        {tab && (
          <>
            <DropdownMenuSeparator />
            <MenuItem
              label={staff === 'tab' ? 'Show the score too' : 'Show the tab only'}
              onClick={() => setStaff(staff === 'tab' ? 'score-tab' : 'tab')}
            />
            <MenuItem
              label={scroll === 'vertical' ? 'Scroll sideways' : 'Scroll down the page'}
              onClick={() => setScroll(scroll === 'vertical' ? 'horizontal' : 'vertical')}
            />
          </>
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

  // What you play and which version, under the title (pick 4): both open
  // the sheet. Line it up beside them when the tab is not lined up yet.
  const linedPct = tab && isLinedUp(tab.timing) ? confidencePercent(tab) : null;
  const chooseNode = tab ? (
    <div data-testid="tab-choose" className="flex min-w-0 items-center gap-cluster">
      <button
        type="button"
        data-testid="tab-instrument"
        aria-label={`What you play: ${currentPart ?? 'Guitar'}`}
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        onClick={openSheet}
        className={cn(PICK_BUTTON, 'font-semibold text-foreground')}
      >
        <InstrumentIcon name={currentPart ?? ''} className="size-4 shrink-0" />
        <span className="min-w-0 truncate">{currentPart ?? 'Guitar'}</span>
        <ChevronDownIcon className="size-3 shrink-0" />
      </button>
      <button
        type="button"
        data-testid="tab-source-chip"
        aria-label="Choose a tab"
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        onClick={openSheet}
        title={sourceChipLabel(tab, currentPart ?? undefined)}
        className={cn(PICK_BUTTON, 'text-muted-foreground')}
      >
        <span className="min-w-0 truncate">{versionLabel(currentVersions, tab)}</span>
        {linedPct !== null && <span className="shrink-0 tabular-nums text-ember">{linedPct}%</span>}
        <ChevronDownIcon className="size-3 shrink-0" />
      </button>
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
    </div>
  ) : null;

  const statusLines = (
    <>
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
    </>
  );

  // The pill: play from here (after the count-in), where the song is on
  // the tab, the speed and the loop.
  const speedPercent = Math.round(speed * 100);
  const at = barPosition(timeline, toTabMs(position));
  const counting = countIn.beat !== null;
  const pillLabel = counting
    ? `Count ${(countIn.beat! % countIn.beatsPerBar) + 1}`
    : !timeline || !at
      ? 'Bar …'
      : follows
        ? `Bar ${at.bar} / ${at.total}`
        : `${at.total} bars`;
  const playPause = () => {
    if (counting) {
      countIn.cancel();
      return;
    }
    if (!follows) {
      if (song.track) playTrack(song.track);
      return;
    }
    if (isPlaying || !countInBars || !timeline) {
      toggle();
      return;
    }
    const bar = barAtMs(timeline, toTabMs(position)) ?? timeline.bars[0];
    const plan = countInPlan(countInBars, {
      bpm: bpmOverride ?? tabBpmNow,
      numerator: bar?.numerator,
      denominator: bar?.denominator,
      rate: playRate,
    });
    countIn.start(plan, () => {
      if (!playingNow.current) toggle();
    });
  };
  const showTool = (id: ToolId) => {
    if (phone) setToolsOpen(true);
    setOpenTool(id);
  };
  const loopPill = () => {
    if (loopRange) setLoopRange(loopRange, !loopOn);
    else showTool('loop');
  };
  const startPicking = () => {
    if (!tab) return;
    if (pickingNow) {
      setPicking(null);
      return;
    }
    // The popover goes so the tab can be tapped; the banner says what next.
    setPicking({ tabId: tab.id, first: null });
    setOpenTool(null);
  };

  const cells = toolCells({
    speedPercent,
    loopOn,
    loopLabel: loopRange ? rangeLabel(loopRange) : null,
    metronomeOn,
    bpm: bpmOverride ?? tabBpmNow,
    countIn: countInBars,
    offsetMs,
    offsetText: formatOffset(offsetMs, offsetUnit, beatClock),
  });
  const editor = (id: ToolId) => {
    if (!tab) return null;
    if (id === 'speed') return <SpeedEditor canSetRate={canSetRate} speed={speed} onSpeed={setSpeed} tabBpm={tabBpmNow} />;
    if (id === 'loop')
      return (
        <LoopEditor
          timeline={!!timeline}
          barTotal={timeline ? barCount(timeline) : 0}
          sections={timeline ? sectionRanges(timeline) : []}
          range={loopRange}
          loopOn={loopOn}
          onLoopOn={(on) => loopRange && setLoopRange(loopRange, on)}
          onRange={(r) => setLoopRange(r, loop?.on ?? true)}
          onClear={() => {
            setLoopRange(null);
            setPicking(null);
          }}
          picking={!!pickingNow}
          onPick={startPicking}
        />
      );
    if (id === 'click')
      return (
        <ClickEditor
          on={metronomeOn}
          canClick={!!timeline}
          onToggle={toggleMetronome}
          tabBpm={tabBpmNow}
          steps={timeline ? tempoSteps(timeline) : []}
          override={bpmOverride}
          onOverride={setBpmOverride}
        />
      );
    if (id === 'count') return <CountInEditor value={countInBars} onChange={setCountIn} />;
    return (
      <DelayEditor
        offsetMs={offsetMs}
        unit={offsetUnit}
        clock={beatClock}
        onUnitChange={setOffsetUnit}
        shared={tab.offsetMs}
        canShare={tab.canDelete}
        onChange={changeOffset}
        onShare={() =>
          sources.saveOffset(tab.id, offsetMs).then(
            () => changeOffset(null),
            // Not saved: the nudge stays on this device, and the listener
            // is told rather than left guessing.
            () => toast.error("Couldn't save the timing for everyone. It is still saved on this device."),
          )
        }
      />
    );
  };
  const popover = openTool && (
    <ToolPopover id={openTool} title={cells.find((c) => c.id === openTool)?.name ?? ''}>
      {editor(openTool)}
    </ToolPopover>
  );

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

      {tab ? (
        <>
          <div
            ref={stickyRef}
            data-testid="tabs-sticky"
            className="sticky top-(--ember-topbar-h,0px) z-20 -mt-page border-b border-border bg-background/95 pb-cluster backdrop-blur md:-mt-page-lg"
          >
            <StageHeader
              title={song.title}
              meta={stageMeta(song.artist, info, trackIndex, speed)}
              metaTitle={meta}
              dim={follows && isPlaying && !sheetOpen && !openTool}
              chip={phone ? undefined : chooseNode}
              below={phone ? chooseNode : undefined}
              actions={actions}
              onBack={onBack}
            />
            {!phone && (
              <div ref={toolsRef} className="relative">
                <PracticeToolbar phone={false} cells={cells} open={openTool} onOpen={setOpenTool} />
                {popover && <div className="absolute left-0 top-full z-30 mt-cluster w-[min(30rem,100%)]">{popover}</div>}
              </div>
            )}
            {pickingNow && (
              <div
                role="status"
                data-testid="tab-loop-picking"
                className="mt-cluster flex items-center gap-cluster rounded-lg border border-ember/40 bg-ember/10 px-row py-cluster text-xs text-foreground"
              >
                <RepeatIcon className="size-4 shrink-0 text-ember" />
                <span className="min-w-0 flex-1">
                  {pickingNow.first === null
                    ? `${phone ? 'Tap' : 'Click'} the first bar of the loop.`
                    : `Now ${phone ? 'tap' : 'click'} its last bar.`}
                </span>
                <Button size="sm" variant="outline" onClick={() => setPicking(null)}>
                  Cancel
                </Button>
              </div>
            )}
            {statusLines}
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
              // The title line and the toolbar, plus the desktop top bar
              // they stick under (`--ember-topbar-h`, 0 on a phone).
              const el = stickyRef.current;
              if (!el) return 0;
              const bar = parseFloat(getComputedStyle(el).getPropertyValue('--ember-topbar-h')) || 0;
              return el.getBoundingClientRect().height + bar;
            }}
            className="mt-block"
          />
          <div
            data-tabs-dock
            data-tools={phone && toolsOpen ? 'open' : undefined}
            className="pointer-events-none sticky bottom-cluster z-20 mt-block flex flex-col items-center gap-cluster"
          >
            {phone && toolsOpen && (
              <div ref={toolsRef} className="flex w-full flex-col gap-cluster">
                {popover}
                <PracticeToolbar phone cells={cells} open={openTool} onOpen={setOpenTool} />
              </div>
            )}
            <div ref={pillRef} className="max-w-full">
              <PlayPill
                playing={(follows && isPlaying) || counting}
                canPlay={follows || !!song.track}
                onPlayPause={playPause}
                label={pillLabel}
                speedPercent={speedPercent}
                canSetRate={canSetRate}
                onSlower={() => setSpeed(rateFromPercent(nextSlower(speedPercent)))}
                loopOn={loopOn}
                loopLabel={loopRange ? rangeLabel(loopRange) : null}
                onLoop={loopPill}
                more={
                  phone
                    ? {
                        open: toolsOpen,
                        onToggle: () => {
                          setOpenTool(null);
                          setToolsOpen(!toolsOpen);
                        },
                      }
                    : undefined
                }
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <TabSheetHeader phone={phone} title={song.title} meta={meta} actions={actions} onBack={onBack} />
          {statusLines}
          <NoTab sources={sources} searchLinks={searchLinks} song={song} onAddFile={addFile} />
        </>
      )}
      <TabSourceSheet
        open={sheetOpen}
        phone={phone}
        title={song.title}
        artist={song.artist}
        instruments={instruments}
        instrument={listed}
        onInstrument={setSheetInstrument}
        versions={versions}
        current={tab ? { id: tab.id, track: trackIndex } : null}
        searching={sources.searchingOnline && sources.tabs.length === 0}
        emptyNote="Ember found nothing online for this song yet."
        onPick={choose}
        onClose={() => setSheetOpen(false)}
        onLineUp={sources.lineUp}
        onDelete={removeTab}
        actions={sheetActions}
      />
    </div>
  );
}

/** The tab page's menus never run off the screen: at most the
 *  viewport less a margin, whatever the trigger's width. */
const MENU_CLASS = 'w-max min-w-56 max-w-[calc(100vw-2rem)]';

/** The two buttons under the title: what you play, which version. */
const PICK_BUTTON =
  'inline-flex min-w-0 max-w-full items-center gap-inset rounded-lg border border-border px-cluster py-inset text-xs transition-colors hover:bg-muted';

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
