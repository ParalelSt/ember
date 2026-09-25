'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, ChevronDownIcon, CloseIcon, MoreIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ShellPreview } from '@/components/library/options/changelog/ShellPreview';
import { ScaledFrame } from '@/components/library/options/changelog/ChangelogSection';
import { TabScore } from '@/components/library/options/tabs/TabScore';
import { SAMPLE_SONG, SAMPLE_TRACKS } from '@/components/library/options/tabs/sample';
import {
  TABS_V3_PICKER,
  TABS_V3_STATE,
  type TabsScroll,
  type TabsStaff,
  type TabsV3Picker,
  type TabsV3State,
} from '@/components/library/options/tabs';
import { TabsToolbar, chip, chipOff, chipOn } from '@/components/tabs/TabsToolbar';
import { TabSheetHeader, TabSourceChip } from '@/components/tabs/TabSheetHeader';
import { TabSourceSheet, type TabSheetAction } from '@/components/tabs/TabSourceSheet';
import type { TabSheetRow } from '@/lib/tabPick';
import { tabSearchLinks } from '@/lib/tabSearchLinks';
import { cn } from '@/lib/utils';
import {
  MOCK_LINED_THRESHOLD,
  MOCK_NOT_LINED_CONFIDENCE,
  MOCK_TAB_SOURCES,
  type MockTabSite,
  type MockTabSource,
} from '@/app/(app)/dizajn/mock';

const DESKTOP = { width: 1100, height: 700 };
const PHONE = { width: 390, height: 780 };
const NOOP = () => {};
const SONG = { title: SAMPLE_SONG.title, artist: SAMPLE_SONG.artist };
const SITE_ORDER: MockTabSite[] = ['songsterr', 'ug', 'server'];

/** The sources a state lists: every one when a tab is drawn (the Songsterr
 *  match under the threshold in "not lined up yet"), none while searching
 *  or when nothing was found. */
function sourcesFor(state: TabsV3State): MockTabSource[] {
  if (state === 'found') return MOCK_TAB_SOURCES;
  if (state === 'not-lined-up') {
    return MOCK_TAB_SOURCES.map((s) => (s.site === 'songsterr' ? { ...s, lined: MOCK_NOT_LINED_CONFIDENCE } : s));
  }
  return [];
}

const isLined = (lined: number | null) => lined !== null && lined >= MOCK_LINED_THRESHOLD;

function chipLabel(state: TabsV3State, source: MockTabSource | undefined): string {
  if (state === 'searching') return 'Searching online…';
  if (state === 'nothing' || !source) return 'Nothing found online';
  return `${source.chip}, ${isLined(source.lined) ? 'lined up' : 'not lined up yet'}`;
}

function metaLine(state: TabsV3State, track: number): string {
  if (state === 'searching' || state === 'nothing') return SAMPLE_SONG.artist;
  const t = SAMPLE_TRACKS[track];
  return `${SAMPLE_SONG.artist} · ${SAMPLE_SONG.tempo} bpm · ${SAMPLE_SONG.key} · ${t.instrument}, ${t.tuning} (${t.strings})`;
}

function Rating({ source, long = false }: { source: MockTabSource; long?: boolean }) {
  if (source.rating === undefined) return null;
  const votes = (source.votes ?? 0).toLocaleString('en-US');
  return (
    <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
      <span aria-hidden className="text-ember">
        ★
      </span>{' '}
      {source.rating.toFixed(1)}
      {long ? ` from ${votes} votes` : ` · ${votes}`}
    </span>
  );
}

/** "Lined up 94%" in ember, or a quiet "Not lined up yet". */
function LinedBadge({ lined }: { lined: number | null }) {
  const ok = isLined(lined);
  return (
    <span
      data-testid="v3-lined"
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-cluster py-inset text-[11px] font-medium leading-none',
        ok ? 'bg-ember/15 text-ember' : 'bg-muted text-muted-foreground',
      )}
    >
      {ok ? `Lined up ${lined}%` : 'Not lined up yet'}
    </span>
  );
}

/** Which sites Ember is checking, one at a time (the Searching state). */
function SiteChecks() {
  const rows = [
    { site: 'Songsterr', status: 'Checking…', active: true },
    { site: 'Ultimate Guitar', status: 'Next', active: false },
    { site: 'On this server', status: 'No tabs yet', active: false },
  ];
  return (
    <ul data-testid="v3-site-checks" className="flex flex-col gap-cluster">
      {rows.map((r) => (
        <li key={r.site} className="flex min-w-0 items-center gap-cluster text-xs">
          <span
            aria-hidden
            className={cn('size-1.5 shrink-0 rounded-full', r.active ? 'animate-pulse bg-ember' : 'bg-muted-foreground/40')}
          />
          <span className="shrink-0 font-medium text-foreground">{r.site}</span>
          <span className="min-w-0 truncate text-muted-foreground">{r.status}</span>
        </li>
      ))}
    </ul>
  );
}

/** The actions under every picker: the plan's two new ones, then the ways
 *  to add a tab by hand. */
function PickerActions({ state, className }: { state: TabsV3State; className?: string }) {
  const drawn = state === 'found' || state === 'not-lined-up';
  const items = [drawn && 'Line it up again', state !== 'searching' && 'Search online again', 'Paste a tab', 'Add a file'].filter(
    Boolean,
  ) as string[];
  return (
    <div className={className}>
      {items.map((label) => (
        <button
          key={label}
          type="button"
          role="menuitem"
          className="block w-full truncate rounded-md px-row py-cluster text-left text-sm transition-colors hover:bg-muted"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function groupBySite(sources: MockTabSource[]) {
  return SITE_ORDER.map((site) => ({ site, items: sources.filter((s) => s.site === site) })).filter((g) => g.items.length > 0);
}

interface PickerProps {
  state: TabsV3State;
  sources: MockTabSource[];
  selectedId: string;
  phone: boolean;
  onPick: (id: string) => void;
  onClose: () => void;
}

/** A. The chip's dropdown: grouped by site in rank order, one line per tab
 *  (name, then type and instruments), the rating and alignment on the
 *  right. The name column truncates; the right column never wraps. */
function PickerMenu({ state, sources, selectedId, phone, onPick }: PickerProps) {
  return (
    <div
      data-testid="v3-picker-menu"
      role="menu"
      aria-label="Choose a tab"
      className={cn(
        'absolute left-0 top-full z-30 mt-cluster flex max-h-[26rem] max-w-full flex-col overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-popover p-inset text-popover-foreground shadow-soft',
        phone ? 'w-full' : 'w-[30rem]',
      )}
    >
      {state === 'searching' && (
        <div className="px-row py-cluster">
          <div className="text-eyebrow mb-cluster">Looking online</div>
          <SiteChecks />
        </div>
      )}
      {state === 'nothing' && (
        <p className="px-row py-cluster text-sm text-muted-foreground">
          Ember checked Songsterr and Ultimate Guitar today. Nothing for this song yet.
        </p>
      )}
      {groupBySite(sources).map((g) => (
        <div key={g.site} role="group" aria-label={g.items[0].siteLabel}>
          <div className="text-eyebrow px-row pb-inset pt-cluster">{g.items[0].siteLabel}</div>
          {g.items.map((s) => {
            const on = s.id === selectedId;
            const sub = [s.type, s.instruments.join(', ')].join(' · ');
            return (
              <button
                key={s.id}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                data-testid="v3-picker-row"
                onClick={() => onPick(s.id)}
                className={cn(
                  'flex w-full min-w-0 items-start gap-cluster rounded-md px-row py-cluster text-left transition-colors hover:bg-muted',
                  on && 'bg-muted/60',
                )}
              >
                <span className="mt-inset grid size-4 shrink-0 place-items-center text-ember">
                  {on && <CheckIcon className="size-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span title={s.name} className={cn('block truncate text-sm font-medium', on && 'text-ember')}>
                    {s.name}
                  </span>
                  <span title={sub} className="block truncate text-xs text-muted-foreground">
                    {sub}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-inset">
                  <LinedBadge lined={s.lined} />
                  <Rating source={s} />
                </span>
              </button>
            );
          })}
        </div>
      ))}
      <div aria-hidden className="mx-row my-inset h-px bg-border" />
      <PickerActions state={state} />
    </div>
  );
}

const PREVIEWS: Record<MockTabSource['preview'], string> = {
  guitar: String.raw`e|----------------|----------------|
B|----------------|----------------|
G|----------------|--------5-7-5---|
D|-0-0-00-0-3---5-|-0-0-3-----7----|
A|-0-0-00-0-3---5-|-0-0-3----------|
D|-0-0-00-0-3---5-|-0-0-3-0-5------|`,
  bass: String.raw`G|----------------|----------------|
D|----------------|----------------|
A|----------------|----------------|
D|-0-0-00-0-3-5---|-0-0-3-0-5-0-3-5|`,
  rough: String.raw`e|----------------|----------------|
B|----------------|----------------|
G|----------------|----------------|
D|-0---0---3---5--|-0---3---5------|
A|-0---0---3---5--|-0---3---5------|
D|-0---0---3---5--|-0---3---5---0--|`,
};

/** A mock match as the production sheet's row (lib/tabPick.ts builds the
 *  real ones from the store). The sheet itself is the very component the
 *  tab page uses: components/tabs/TabSourceSheet.tsx. */
function mockRow(s: MockTabSource, selectedId: string): TabSheetRow {
  const ok = isLined(s.lined);
  const votes = (s.votes ?? 0).toLocaleString('en-US');
  return {
    id: s.id,
    group: s.site,
    groupLabel: s.siteLabel,
    type: s.type,
    name: s.name,
    rating: s.rating === undefined ? '' : `\u2605 ${s.rating.toFixed(1)} (${votes} votes)`,
    instruments: s.instruments,
    confidence: s.lined,
    linedUp: ok,
    status: ok ? `Lined up ${s.lined}%` : 'Not lined up yet',
    badge: s.id === selectedId ? 'Best match' : null,
    addedBy: null,
    drawn: s.id === selectedId,
    canDelete: false,
    canLineUp: true,
    aligning: false,
  };
}

/** The sheet's inert footer buttons, the same set PickerActions lists. */
function mockActions(state: TabsV3State): TabSheetAction[] {
  const drawn = state === 'found' || state === 'not-lined-up';
  const all: (TabSheetAction | null)[] = [
    drawn ? { id: 'line-up', label: 'Line it up again', onClick: NOOP } : null,
    state !== 'searching' ? { id: 'search', label: 'Search online again', onClick: NOOP } : null,
    { id: 'paste', label: 'Paste a tab', onClick: NOOP, variant: 'ghost' },
    { id: 'file', label: 'Add a file', onClick: NOOP, variant: 'ghost' },
  ];
  return all.filter((a): a is TabSheetAction => !!a);
}

const NOTHING_NOTE = 'Ember checked Songsterr and Ultimate Guitar today. Nothing for this song yet.';

/** Where the score will be, while Ember looks: a toolbar and three
 *  systems of six string lines, pulsing. */
function ScoreSkeleton({ phone }: { phone: boolean }) {
  return (
    <div data-testid="v3-score-skeleton" aria-hidden className="flex flex-col gap-stack">
      <div className="flex gap-cluster">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-6 w-16 rounded-full" />
        ))}
      </div>
      {[0, 1, 2].map((sys) => (
        <div key={sys} className="relative flex animate-pulse flex-col gap-cluster">
          {[0, 1, 2, 3, 4, 5].map((l) => (
            <div key={l} className="h-px bg-border" />
          ))}
          <div className="absolute inset-0 flex items-center justify-around">
            {Array.from({ length: phone ? 4 : 8 }, (_, i) => (
              <div key={i} className="h-full w-px bg-border" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Searching({ phone }: { phone: boolean }) {
  return (
    <div data-testid="v3-searching" className="mt-block flex flex-col gap-stack">
      <div role="status" className="flex flex-col gap-row rounded-lg bg-card px-block py-row">
        <div className="text-sm font-medium">
          Looking for tabs for {SONG.title} by {SONG.artist}…
        </div>
        <SiteChecks />
      </div>
      <ScoreSkeleton phone={phone} />
    </div>
  );
}

/** Nothing online: search by hand, paste, add a file, and the rough
 *  generated tab last. */
function NothingOnline() {
  return (
    <div data-testid="v3-nothing" className="mt-section flex flex-col items-center gap-block text-center">
      <div>
        <p className="font-medium">No tab online for this song yet.</p>
        <p className="text-meta mt-inset">Ember checked Songsterr and Ultimate Guitar.</p>
      </div>
      <div className="flex flex-col items-center gap-cluster">
        <div className="text-eyebrow">Find one yourself</div>
        <div className="flex flex-wrap justify-center gap-cluster">
          {tabSearchLinks(SONG).map((l) => (
            <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" className={cn(chip, chipOff)}>
              {l.label}
            </a>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-cluster">
        <Button>Paste a tab</Button>
        <Button variant="outline">Add a file</Button>
        <Button variant="ghost">Generate from the recording (rough)</Button>
      </div>
      <p className="text-meta max-w-md">
        A pasted tab or a Guitar Pro file is shared with everyone here and lined up with the recording. Generating
        listens to the song and writes a guitar tab: a few minutes, rough in places, so it is the last resort.
      </p>
    </div>
  );
}

/** The calm note over a tab Ember could not line up. */
function NotLinedNote() {
  return (
    <div
      data-testid="v3-not-lined"
      className="mt-block flex flex-wrap items-center gap-row rounded-lg bg-card px-block py-row text-sm"
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-muted-foreground/60" />
      <div className="min-w-0 flex-1 basis-60">
        <div className="font-medium">Not lined up yet</div>
        <div className="text-meta mt-inset">
          Ember could not match this tab to the recording ({MOCK_NOT_LINED_CONFIDENCE}% sure), so it starts from the top.
          Line it up listens again; Sync moves it by hand.
        </div>
      </div>
      <Button size="sm" variant="outline" className="shrink-0">
        Line it up
      </Button>
    </div>
  );
}

/** The Sync nudge as the tab page draws it (TabsPage's SyncRow), inert. */
function SyncRow() {
  return (
    <div data-testid="v3-sync" className="mt-cluster flex flex-wrap items-center gap-row text-xs text-muted-foreground">
      <input
        type="range"
        min={-10}
        max={10}
        step={0.1}
        defaultValue={0}
        aria-label="Tab timing offset in seconds"
        className="min-w-40 flex-1 accent-ember"
      />
      <Button size="sm" variant="ghost">
        Reset
      </Button>
    </div>
  );
}

interface ViewProps {
  phone: boolean;
  picker: TabsV3Picker;
  state: TabsV3State;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedId: string;
  onPick: (id: string) => void;
  staff: TabsStaff;
  scroll: TabsScroll;
  track: number;
  onStaffChange: (staff: TabsStaff) => void;
  onScrollChange: (scroll: TabsScroll) => void;
  onTrackChange: (track: number) => void;
}

/** The tab page, today's header, toolbar and score, with the v3 pieces. */
function V3Page(p: ViewProps) {
  const sources = sourcesFor(p.state);
  const source = sources.find((s) => s.id === p.selectedId) ?? sources[0];
  const drawn = p.state === 'found' || p.state === 'not-lined-up';
  const lined = source && isLined(source.lined);
  const label = chipLabel(p.state, source);

  const chipNode = (
    <TabSourceChip label={label}>
      <button
        type="button"
        data-testid="v3-source-trigger"
        aria-haspopup={p.picker === 'menu' ? 'menu' : 'dialog'}
        aria-expanded={p.open}
        onClick={() => p.onOpenChange(!p.open)}
        title={label}
        className="inline-flex min-w-0 max-w-full items-center gap-inset hover:text-foreground"
      >
        <span className="min-w-0 truncate">{label}</span>
        {drawn && lined && source && <span className="shrink-0 tabular-nums text-ember">{source.lined}%</span>}
        <ChevronDownIcon className="size-3 shrink-0" />
      </button>
    </TabSourceChip>
  );

  const actions = (
    <button
      type="button"
      aria-label="Tab options"
      className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <MoreIcon className="size-4" />
    </button>
  );

  const pickerProps: PickerProps = {
    state: p.state,
    sources,
    selectedId: source?.id ?? '',
    phone: p.phone,
    onPick: (id) => {
      p.onPick(id);
      p.onOpenChange(false);
    },
    onClose: () => p.onOpenChange(false),
  };

  return (
    <div data-testid="v3-page" data-state={p.state}>
      <div className="relative">
        <TabSheetHeader phone={p.phone} title={SONG.title} meta={metaLine(p.state, p.track)} chip={chipNode} actions={actions} />
        {p.picker === 'menu' && p.open && <PickerMenu {...pickerProps} />}
      </div>

      {p.state === 'searching' && <Searching phone={p.phone} />}
      {p.state === 'nothing' && <NothingOnline />}
      {drawn && (
        <>
          <div className="sticky top-0 z-20 mt-block border-b border-border bg-background/95 py-cluster backdrop-blur">
            <TabsToolbar
              phone={p.phone}
              staff={p.staff}
              scroll={p.scroll}
              tracks={SAMPLE_TRACKS}
              track={p.track}
              onStaffChange={p.onStaffChange}
              onScrollChange={p.onScrollChange}
              onTrackChange={p.onTrackChange}
            >
              <button
                type="button"
                aria-label="Sync"
                aria-pressed={p.state === 'not-lined-up'}
                className={cn(chip, p.state === 'not-lined-up' ? chipOn : chipOff)}
              >
                Sync
                <span className="font-normal tabular-nums">0.0s</span>
              </button>
            </TabsToolbar>
            {p.state === 'not-lined-up' && <SyncRow />}
          </div>
          {p.state === 'not-lined-up' && <NotLinedNote />}
          <TabScore
            staff={p.staff}
            scroll={p.scroll}
            track={p.track}
            scale={p.phone ? 0.65 : 0.95}
            cursor={p.state === 'found'}
            className="mt-block"
          />
        </>
      )}
    </div>
  );
}

export interface FoundOnlineSectionProps {
  picker: TabsV3Picker;
  state: TabsV3State;
}

/** Tabs v3: the tab page once Ember finds tabs online
 *  and lines them up with the recording, in the whole shell, desktop and
 *  phone, plus a 1:1 full-screen view. Mock sources, a real AlphaTab score
 *  from the bundled original riff; nothing is fetched and every action is
 *  inert. The picker starts open so the candidate is what you see first. */
export function FoundOnlineSection({ picker, state }: FoundOnlineSectionProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [desktopScale, setDesktopScale] = useState(1);
  const [open, setOpen] = useState(true);
  const [selectedId, setSelectedId] = useState(MOCK_TAB_SOURCES[0].id);
  const [staff, setStaff] = useState<TabsStaff>('tab');
  const [scroll, setScroll] = useState<TabsScroll>('vertical');
  const [track, setTrack] = useState(0);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const pickerText = TABS_V3_PICKER.find((o) => o.id === picker)?.description ?? '';
  const stateText = TABS_V3_STATE.find((o) => o.id === state)?.description ?? '';

  const shell = (phone: boolean) => {
    const view: ViewProps = {
      phone,
      picker,
      state,
      open,
      onOpenChange: setOpen,
      selectedId,
      onPick: setSelectedId,
      staff,
      scroll,
      track,
      onStaffChange: setStaff,
      onScrollChange: setScroll,
      onTrackChange: setTrack,
    };
    const sheetSources = sourcesFor(state);
    const sheet =
      picker === 'sheet' ? (
        <TabSourceSheet
          open={open}
          phone={phone}
          position="absolute"
          title={SONG.title}
          artist={SONG.artist}
          rows={sheetSources.map((s) => mockRow(s, selectedId))}
          searching={state === 'searching'}
          emptyNote={NOTHING_NOTE}
          previewOf={(row) => PREVIEWS[sheetSources.find((s) => s.id === row.id)?.preview ?? 'guitar']}
          onPick={(id) => {
            setSelectedId(id);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
          actions={mockActions(state)}
        />
      ) : null;
    let overlay: ReactNode = null;
    let cover: ReactNode = null;
    if (phone) cover = sheet;
    else overlay = sheet;
    return (
      <div className="relative h-full w-full">
        <ShellPreview
          phone={phone}
          activePath=""
          drawerOpen={false}
          onDrawerOpenChange={NOOP}
          content={<V3Page {...view} />}
          overlay={overlay}
        />
        {cover}
      </div>
    );
  };

  return (
    <div data-testid="tabs-v3-section" data-picker={picker} data-state={state}>
      <div className="flex flex-col gap-stack lg:flex-row lg:items-start">
        <div className="min-w-0 lg:flex-[1100_1_0%]">
          <div className="mb-cluster flex min-h-7 items-center justify-between gap-row">
            <div className="text-eyebrow">
              Desktop <span className="normal-case tracking-normal">({Math.round(desktopScale * 100)}%)</span>
            </div>
            <div className="flex items-center gap-cluster">
              <button
                type="button"
                aria-pressed={open}
                onClick={() => setOpen((o) => !o)}
                className="rounded-full border border-border px-row py-inset text-xs font-medium transition-colors hover:bg-card"
              >
                {open ? 'Close the picker' : 'Open the picker'}
              </button>
              <button
                type="button"
                onClick={() => setFullscreen(true)}
                className="rounded-full border border-border px-row py-inset text-xs font-medium transition-colors hover:bg-card"
              >
                View full screen
              </button>
            </div>
          </div>
          <ScaledFrame width={DESKTOP.width} height={DESKTOP.height} onScale={setDesktopScale}>
            {shell(false)}
          </ScaledFrame>
        </div>
        <div className="w-full min-w-0 max-w-[390px] lg:flex-[390_1_0%]">
          <div className="mb-cluster flex min-h-7 items-center">
            <div className="text-eyebrow">Phone (390px)</div>
          </div>
          <ScaledFrame width={PHONE.width} height={PHONE.height}>
            {shell(true)}
          </ScaledFrame>
        </div>
      </div>

      <p data-testid="tabs-v3-description" className="text-meta mt-block">
        {pickerText}
      </p>
      <p data-testid="tabs-v3-state-description" className="text-meta mt-cluster">
        {stateText}
      </p>

      {fullscreen &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Full screen tabs v3 preview"
            data-testid="tabs-v3-fullscreen"
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
