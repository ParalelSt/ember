'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import { ChevronDownIcon, MoreIcon, PlayIcon } from '@/components/icons';
import { EmptyState } from '@/components/page/EmptyState';
import { usePlayer } from '@/components/player/PlayerProvider';
import { LiveTabScore } from '@/components/tabs/LiveTabScore';
import { TabSheetHeader, TabSourceChip } from '@/components/tabs/TabSheetHeader';
import { TabsToolbar, chip, chipOff, chipOn } from '@/components/tabs/TabsToolbar';
import { useTabSong, useTabSources, type TabSong, type TabSourcesState } from '@/hooks/useTabSources';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { cn } from '@/lib/utils';
import { metaLine, scoreScale, type ScoreInfo, type TabsScroll, type TabsStaff } from '@/lib/tabScore';
import {
  emptyStateFor,
  followTrackChange,
  localOffsetId,
  pickTab,
  pickerLabel,
  sourceChipLabel,
  type TabSummary,
} from '@/lib/tabSources';
import { clampOffset, loadLocalOffsetMs, MAX_OFFSET_MS, saveLocalOffsetMs } from '@/lib/tabSync';
import { tabSearchLinks, type TabSearchLink } from '@/lib/tabSearchLinks';

const TAB_ACCEPT = '.gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.xml,.mxl';
const STAFF_KEY = 'ember.tabs.staff';
const SCROLL_KEY = 'ember.tabs.scroll';
const trackKey = (tabId: string) => `ember.tab.track.${tabId}`;

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

  const [chosenId, setChosenId] = useState<string | null>(null);
  const tab = pickTab(sources.tabs, chosenId);

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

  const [info, setInfo] = useState<ScoreInfo | null>(null);
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

  const stickyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const meta = metaLine(song.artist, tab ? info : null, trackIndex);
  const addFile = () => fileRef.current?.click();
  const ownGenerated = sources.tabs.some((t) => t.kind === 'generated' && t.trackId === song.id);
  const busyGenerating = sources.generated === 'running' || sources.generating;
  // Links only: the browser opens them, Ember never fetches a tab site.
  const searchLinks = tabSearchLinks(song, sources.matches);

  const actions = (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Tab options"
        className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MoreIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuItem onClick={addFile}>Add a Guitar Pro or MusicXML file</DropdownMenuItem>
        {sources.canGenerate && !ownGenerated && (
          <DropdownMenuItem disabled={busyGenerating} onClick={sources.generate}>
            {busyGenerating ? 'Transcribing…' : 'Generate a tab from the recording'}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {searchLinks.map((l) => (
          <DropdownMenuItem key={l.id} onClick={() => window.open(l.url, '_blank', 'noopener,noreferrer')}>
            {l.menuLabel}
          </DropdownMenuItem>
        ))}
        {tab?.canDelete && !tab.id.startsWith('generated:') && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => {
                if (window.confirm('Delete this tab for everyone?')) {
                  setChosenId(null);
                  sources.remove(tab.id);
                }
              }}
            >
              Delete this tab
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const chipNode = tab ? <SourceChip tab={tab} tabs={sources.tabs} onPick={setChosenId} /> : null;

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
            className="sticky top-0 z-20 mt-block border-b border-border bg-background/95 py-cluster backdrop-blur"
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
                <span className="tabular-nums font-normal">
                  {offsetMs > 0 ? '+' : ''}
                  {(offsetMs / 1000).toFixed(1)}s
                </span>
              </button>
            </TabsToolbar>
            {syncOpen && (
              <SyncRow
                offsetMs={offsetMs}
                shared={tab.offsetMs}
                canShare={tab.canDelete && !tab.id.startsWith('generated:')}
                onChange={changeOffset}
                onShare={() => sources.saveOffset(tab.id, offsetMs).then(() => changeOffset(null))}
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
            follows={follows}
            playing={isPlaying}
            position={position}
            duration={duration}
            onSeek={seek}
            onScore={setInfo}
            getPageScroller={() => stickyRef.current?.closest<HTMLElement>('[data-app-scroller]') ?? null}
            getTopInset={() => stickyRef.current?.getBoundingClientRect().height ?? 0}
            className="mt-block"
          />
        </>
      ) : (
        <NoTab sources={sources} searchLinks={searchLinks} onAddFile={addFile} />
      )}
    </div>
  );
}

/** "File added by Aron, shared", "Text tab pasted by Aron, shared" or
 *  "Generated from the recording, rough"; with more than one tab for the
 *  song it opens a menu to switch between them, in chain order. */
function SourceChip({ tab, tabs, onPick }: { tab: TabSummary; tabs: TabSummary[]; onPick: (id: string) => void }) {
  const label = sourceChipLabel(tab);
  if (tabs.length < 2) return <TabSourceChip label={label} />;
  return (
    <TabSourceChip label={label}>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Choose a tab" className="inline-flex items-center gap-inset hover:text-foreground">
          {label}
          <ChevronDownIcon className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          {tabs.map((t) => (
            <DropdownMenuItem key={t.id} onClick={() => onPick(t.id)} className={cn(t.id === tab.id && 'text-ember')}>
              {pickerLabel(t)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </TabSourceChip>
  );
}

/** The nudge: slide the tab against the recording. Kept on this device;
 *  whoever added the tab can save it for everyone. */
function SyncRow({
  offsetMs,
  shared,
  canShare,
  onChange,
  onShare,
}: {
  offsetMs: number;
  shared: number;
  canShare: boolean;
  onChange: (ms: number | null) => void;
  onShare: () => void;
}) {
  return (
    <div data-testid="tab-sync" className="mt-cluster flex flex-wrap items-center gap-row text-xs text-muted-foreground">
      <input
        type="range"
        min={-MAX_OFFSET_MS / 1000}
        max={MAX_OFFSET_MS / 1000}
        step={0.1}
        value={offsetMs / 1000}
        onChange={(e) => onChange(Number(e.target.value) * 1000)}
        className="min-w-40 flex-1 accent-ember"
        aria-label="Tab timing offset in seconds"
      />
      <Button size="sm" variant="ghost" onClick={() => onChange(0)}>
        Reset
      </Button>
      {canShare && offsetMs !== shared && (
        <Button size="sm" variant="outline" onClick={onShare}>
          Save for everyone
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
    generateError: sources.generateError ?? sources.generatedError,
    canGenerate: sources.canGenerate,
    matches: sources.matches,
  });
  if (state.kind === 'loading') return <EmptyState>Looking for a tab…</EmptyState>;
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
          <Button variant="ghost" onClick={sources.generate}>
            Generate a tab (rough)
          </Button>
        )}
      </div>
      <p className="text-meta max-w-md">
        {state.canGenerate
          ? 'A file is a Guitar Pro or MusicXML tab, shared with everyone here. Generating listens to the recording and writes a guitar tab: a few minutes, rough in places, so it is the last resort.'
          : 'A file is a Guitar Pro or MusicXML tab, shared with everyone here.'}
      </p>
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
