'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ShellPreview } from '@/components/library/options/changelog/ShellPreview';
import { ScaledFrame } from '@/components/library/options/changelog/ChangelogSection';
import { TabScore } from '@/components/library/options/tabs/TabScore';
import { PASTE_SAMPLE_SONG, PASTE_SAMPLE_TEXT } from '@/components/library/options/tabs/pasteSample';
import { TABS_PASTE, type TabsPaste } from '@/components/library/options/tabs';
import { TabSheetHeader } from '@/components/tabs/TabSheetHeader';
import { chip, chipOff, chipOn } from '@/components/tabs/TabsToolbar';
import { tabSearchLinks } from '@/lib/tabSearchLinks';
import { fitTempo, parseTabText, reportLine, tapTempo, type TabTextResult } from '@/lib/tabText';
import { cn } from '@/lib/utils';

const DESKTOP = { width: 1100, height: 700 };
const PHONE = { width: 390, height: 780 };
const NOOP = () => {};

type TempoMode = 'fit' | 'tap' | 'typed';

/** Everything a candidate shows, worked out once for every frame: the
 *  text, what the real parser made of it, and the tempo row. */
interface PasteState {
  text: string;
  onText: (text: string) => void;
  result: TabTextResult;
  tempo: number | null;
  mode: TempoMode;
  fit: number | null;
  taps: number;
  onFit: () => void;
  onTap: () => void;
  onTyped: (bpm: number) => void;
}

function duration(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "6 strings, Drop D, 9 bars, 114 notes, 4 lines skipped", the first
 *  warning, and what was skipped behind a disclosure. */
function Report({ state }: { state: PasteState }) {
  const { result } = state;
  const { report } = result;
  return (
    <div data-testid="paste-report" className="min-w-0 text-xs">
      <div className={cn('font-medium', result.ok ? 'text-foreground' : 'text-destructive')}>
        {result.ok ? reportLine(report) : result.error}
      </div>
      {report.warnings[0] && <div className="mt-inset text-muted-foreground">{report.warnings[0]}</div>}
      {report.skipped.length > 0 && (
        <details className="mt-inset text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground">What was skipped</summary>
          <ul className="mt-inset flex flex-col gap-inset">
            {report.skipped.map((s) => (
              <li key={s.line} className="truncate">
                Line {s.line}, {s.reason}: <span className="font-mono">{s.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Tempo: fit to the song's length by default, tap along as the other
 *  way, or type it. The start is lined up later with the Sync nudge. */
function TempoRow({ state }: { state: PasteState }) {
  return (
    <div data-testid="paste-tempo" className="flex flex-wrap items-center gap-cluster text-xs">
      <span className="text-eyebrow">Tempo</span>
      <button
        type="button"
        aria-pressed={state.mode === 'fit'}
        onClick={state.onFit}
        title={`Bars x 4 x 60 / the song's ${duration(PASTE_SAMPLE_SONG.durationSec)}`}
        className={cn(chip, state.mode === 'fit' ? chipOn : chipOff)}
      >
        Fit to song length
      </button>
      <button
        type="button"
        aria-pressed={state.mode === 'tap'}
        onClick={state.onTap}
        title="Tap along to the playing song, four taps or more"
        className={cn(chip, state.mode === 'tap' ? chipOn : chipOff)}
      >
        Tap along{state.mode === 'tap' && state.taps > 0 && state.taps < 4 ? ` (${state.taps})` : ''}
      </button>
      <label className="inline-flex items-center gap-inset text-muted-foreground">
        <input
          type="number"
          min={20}
          max={400}
          aria-label="Beats per minute"
          value={state.tempo ?? ''}
          onChange={(e) => state.onTyped(Number(e.target.value))}
          className="w-14 rounded-md border border-border bg-background px-cluster py-inset text-right text-xs tabular-nums text-foreground"
        />
        bpm
      </label>
    </div>
  );
}

function PasteBox({ state, className }: { state: PasteState; className?: string }) {
  return (
    <textarea
      aria-label="Text tab"
      spellCheck={false}
      wrap="off"
      value={state.text}
      onChange={(e) => state.onText(e.target.value)}
      className={cn(
        'w-full resize-none rounded-lg border border-border bg-card p-row font-mono text-[11px] leading-4 text-foreground outline-none focus-visible:border-ember/60',
        className,
      )}
    />
  );
}

function Preview({ state, phone, className }: { state: PasteState; phone: boolean; className?: string }) {
  const { result } = state;
  return (
    <div data-testid="paste-preview" className={cn('min-h-0 min-w-0 rounded-lg border border-border', className)}>
      {result.ok ? (
        <TabScore
          tex={result.alphaTex}
          staff="tab"
          scroll="vertical"
          track={0}
          scale={phone ? 0.55 : 0.7}
          cursor={false}
          className="p-cluster"
        />
      ) : (
        <div className="text-meta p-block">Nothing to draw yet: {result.error}</div>
      )}
    </div>
  );
}

/** Find a tab: the stage 1 search chips, links only. */
function FindOne() {
  return (
    <div className="flex flex-wrap items-center gap-cluster">
      <span className="text-eyebrow">Find one</span>
      {tabSearchLinks(PASTE_SAMPLE_SONG).map((l) => (
        <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" className={cn(chip, chipOff)}>
          {l.label}
        </a>
      ))}
    </div>
  );
}

/** The Sheet page for a song with no tab yet, as it sits behind the dialog:
 *  the search chips, then Paste a tab, Add a file and the rough last resort. */
function EmptySheet({ phone }: { phone: boolean }) {
  return (
    <div>
      <TabSheetHeader phone={phone} title={PASTE_SAMPLE_SONG.title} meta={PASTE_SAMPLE_SONG.artist} />
      <div className="mt-section flex flex-col items-center gap-block text-center">
        <p className="text-muted-foreground">No tab for this song yet.</p>
        <FindOne />
        <div className="flex flex-wrap justify-center gap-cluster">
          <Button>Paste a tab</Button>
          <Button variant="outline">Add a file</Button>
          <Button variant="ghost">Generate a tab (rough)</Button>
        </div>
      </div>
    </div>
  );
}

/** A. A modal over the tab page: paste on the left, the real score on the
 *  right, the report and tempo underneath, Save in the footer. Stacked and
 *  full screen on a phone. */
function PasteDialog({ state, phone }: { state: PasteState; phone: boolean }) {
  return (
    <div data-testid="paste-layout-dialog" className="absolute inset-0 z-40 flex items-center justify-center bg-black/60">
      <div
        role="dialog"
        aria-label="Paste a text tab"
        className={cn(
          'flex flex-col overflow-hidden bg-popover text-popover-foreground shadow-soft',
          phone ? 'size-full' : 'h-[600px] w-[980px] rounded-2xl border border-border',
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-row border-b border-border px-block py-row">
          <div className="min-w-0">
            <div className="font-semibold">Paste a text tab</div>
            <div className="text-meta mt-inset">
              Copy the tab from any site and paste it here. Ember does not visit tab sites itself.
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>

        {phone ? (
          <div className="flex min-h-0 flex-1 flex-col gap-row overflow-y-auto px-block py-row">
            <PasteBox state={state} className="h-48 shrink-0" />
            <Report state={state} />
            <TempoRow state={state} />
            <Preview state={state} phone className="shrink-0" />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-row px-block py-row">
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-block">
              <PasteBox state={state} className="h-full" />
              <Preview state={state} phone={false} className="overflow-y-auto" />
            </div>
            <div className="flex shrink-0 items-start justify-between gap-block">
              <Report state={state} />
              <TempoRow state={state} />
            </div>
          </div>
        )}

        <div className="flex shrink-0 items-center justify-between gap-row border-t border-border px-block py-row">
          <span className="text-meta truncate">Shared with everyone here, marked Text tab pasted by you.</span>
          <div className="flex shrink-0 gap-cluster">
            <Button variant="ghost">Cancel</Button>
            <Button disabled={!state.result.ok}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** B. The empty tab page turns into the editor: paste on top, the score
 *  below where it will sit, Save in the sticky toolbar. Same on a phone. */
function InlineEditor({ state, phone }: { state: PasteState; phone: boolean }) {
  return (
    <div data-testid="paste-layout-inline">
      <TabSheetHeader phone={phone} title={PASTE_SAMPLE_SONG.title} meta={`${PASTE_SAMPLE_SONG.artist} · Pasting a text tab`} />
      <div className="sticky top-0 z-20 mt-block flex flex-col gap-cluster border-b border-border bg-background/95 py-cluster backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-row">
          <TempoRow state={state} />
          <div className="flex shrink-0 gap-cluster">
            <Button size="sm" variant="ghost">
              Cancel
            </Button>
            <Button size="sm" disabled={!state.result.ok}>
              Save
            </Button>
          </div>
        </div>
        <Report state={state} />
      </div>
      <div className="mt-block">
        <FindOne />
      </div>
      <PasteBox state={state} className="mt-row h-44" />
      <div className="text-eyebrow mt-block">Preview</div>
      <Preview state={state} phone={phone} className="mt-cluster" />
    </div>
  );
}

export interface PasteSectionProps {
  option: TabsPaste;
}

/** The two paste-UI candidates (docs/tab-sources.md section 6) in the whole
 *  Ember shell, desktop and phone, plus a 1:1 full-screen view. The text is
 *  editable and runs through the real parser; the preview is real AlphaTab.
 *  Save, Cancel and the search chips do nothing here. */
export function PasteSection({ option }: PasteSectionProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [desktopScale, setDesktopScale] = useState(1);
  const [text, setText] = useState(PASTE_SAMPLE_TEXT);
  // The preview follows the text after a short pause, not every keystroke.
  const [settled, setSettled] = useState(PASTE_SAMPLE_TEXT);
  const [mode, setMode] = useState<TempoMode>('fit');
  const [taps, setTaps] = useState<number[]>([]);
  const [typed, setTyped] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSettled(text), 400);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const song = { title: PASTE_SAMPLE_SONG.title, artist: PASTE_SAMPLE_SONG.artist };
  const bars = parseTabText(settled, song).report.bars;
  const fit = fitTempo(bars, PASTE_SAMPLE_SONG.durationSec);
  const tempo = mode === 'fit' ? fit : mode === 'tap' ? (tapTempo(taps) ?? fit) : typed;
  const result = parseTabText(settled, { ...song, tempo });

  const state: PasteState = {
    text,
    onText: setText,
    result,
    tempo,
    mode,
    fit,
    taps: taps.length,
    onFit: () => setMode('fit'),
    onTap: () => {
      setMode('tap');
      setTaps((t) => [...t, performance.now()].slice(-8));
    },
    onTyped: (bpm) => {
      setMode('typed');
      setTyped(Number.isFinite(bpm) && bpm > 0 ? bpm : null);
    },
  };

  const description = TABS_PASTE.find((o) => o.id === option)?.description ?? '';

  const shell = (phone: boolean) => {
    let content: ReactNode;
    let cover: ReactNode = null;
    if (option === 'dialog') {
      content = <EmptySheet phone={phone} />;
      cover = <PasteDialog state={state} phone={phone} />;
    } else content = <InlineEditor state={state} phone={phone} />;
    return (
      <div className="relative h-full w-full">
        <ShellPreview phone={phone} activePath="" drawerOpen={false} onDrawerOpenChange={NOOP} content={content} />
        {cover}
      </div>
    );
  };

  return (
    <div data-testid="paste-section" data-option={option}>
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
          <div className="mb-cluster flex min-h-7 items-center">
            <div className="text-eyebrow">Phone (390px)</div>
          </div>
          <ScaledFrame width={PHONE.width} height={PHONE.height}>
            {shell(true)}
          </ScaledFrame>
        </div>
      </div>

      <p data-testid="paste-description" className="text-meta mt-block">
        {description}
      </p>

      {fullscreen &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Full screen paste preview"
            data-testid="paste-fullscreen"
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
