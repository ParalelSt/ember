import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ColourRow, ColourSwatch } from '@/components/settings/appearance/ColourRow';
import { ReadabilityNotes } from '@/components/settings/appearance/ReadabilityNotes';
import type { Finding } from '@/lib/theme/guard';
import type { Oklch } from '@/lib/theme/oklch';
import type { MoreKey } from '@/lib/theme/editor';
import type { ThemeInputKey, ThemeInputs } from '@/lib/theme/model';

type BasicKey = 'background' | 'accent' | 'text';

// "Accent" is the brand colour (--ember), not shadcn's --accent hover
// surface; see lib/theme/model.ts.
const BASICS: { key: BasicKey; label: string }[] = [
  { key: 'background', label: 'Background' },
  { key: 'accent', label: 'Accent' },
  { key: 'text', label: 'Text' },
];

const MORE: { key: MoreKey; label: string }[] = [
  { key: 'surface', label: 'Surface' },
  { key: 'mutedText', label: 'Muted text' },
  { key: 'accentHover', label: 'Accent hover' },
  { key: 'border', label: 'Border' },
  { key: 'sidebar', label: 'Sidebar' },
];

export interface ColourEditorProps {
  inputs: ThemeInputs;
  /** More rows the person set by hand; the rest follow the Basics. */
  pinned: ReadonlySet<MoreKey>;
  /** The guard's warn and fail findings for `inputs`. */
  findings: Finding[];
  /** Someone else's theme: shown, not editable. */
  owner?: string | null;
  /** Not editable for now (the list is still loading). */
  readOnly?: boolean;
  /** A line above the rows (editing a preset makes a new theme). */
  hint?: string | null;
  /** The preset Reset goes back to. */
  baseName: string;
  canReset: boolean;
  onChange: (key: ThemeInputKey, value: Oklch) => void;
  onUnpin: (key: MoreKey) => void;
  onFix: (finding: Finding) => void;
  onReset: () => void;
  onCopy?: () => void;
}

/** 3 across, 2 on a narrow phone. */
const GRID = 'grid grid-cols-2 gap-cluster min-[360px]:grid-cols-3';

/** The Colours tab: Basics (background, accent, text) and More (the other
 *  five, auto-filled until touched) as grids of swatches, the selected one's
 *  controls under them (one place, so the grids never jump when the selection
 *  moves between groups), the readability findings, and Reset to the preset
 *  the theme started from. Someone else's theme can still be looked through,
 *  with the controls read-only. */
export function ColourEditor(props: ColourEditorProps) {
  const { inputs, pinned, findings, owner, hint, baseName, canReset } = props;
  const [confirming, setConfirming] = useState(false);
  const [selected, setSelected] = useState<ThemeInputKey>('background');
  const selectedMore = MORE.find((m) => m.key === selected);
  const selectedLabel = selectedMore?.label ?? BASICS.find((b) => b.key === selected)?.label ?? '';
  const readOnly = !!owner || !!props.readOnly;

  return (
    <div data-testid="colour-editor" className="flex flex-col gap-stack">
      {owner && (
        <div className="flex flex-col gap-cluster">
          <p data-testid="read-only-note" className="text-sm text-muted-foreground">
            Shared by {owner}. Only {owner} can change it. Copy it to your themes to make your own version.
          </p>
          {props.onCopy && (
            <Button size="sm" variant="outline" onClick={props.onCopy} className="self-start">
              Copy to my themes
            </Button>
          )}
        </div>
      )}
      {hint && !owner && <p className="text-sm text-muted-foreground">{hint}</p>}

      <div className="flex flex-col gap-row">
        <div className="text-eyebrow">Basics</div>
        <div className={GRID}>
          {BASICS.map(({ key, label }) => (
            <ColourSwatch
              key={key}
              label={label}
              value={inputs[key]}
              selected={selected === key}
              onSelect={() => setSelected(key)}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-row">
        <div className="text-eyebrow">More</div>
        <div className={GRID}>
          {MORE.map(({ key, label }) => (
            <ColourSwatch
              key={key}
              label={label}
              value={inputs[key]}
              auto={!pinned.has(key)}
              selected={selected === key}
              onSelect={() => setSelected(key)}
            />
          ))}
        </div>
      </div>

      <div id="colour-panel" data-testid="colour-panel" className="rounded-xl bg-card p-row">
        {/* Keyed: a half-typed hex belongs to its own colour. */}
        <ColourRow
          key={selected}
          name={selected}
          label={selectedLabel}
          value={inputs[selected]}
          auto={selectedMore ? !pinned.has(selectedMore.key) : undefined}
          readOnly={readOnly}
          onChange={(v) => props.onChange(selected, v)}
          onReset={selectedMore ? () => props.onUnpin(selectedMore.key) : undefined}
        />
      </div>

      <ReadabilityNotes findings={findings} readOnly={readOnly} onFix={props.onFix} />

      {!readOnly &&
        (confirming ? (
          <div data-testid="reset-confirm" className="flex flex-wrap items-center gap-cluster">
            <p className="min-w-0 flex-1 text-sm">Reset every colour to {baseName}?</p>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                props.onReset();
              }}
            >
              Reset
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={!canReset}
            onClick={() => setConfirming(true)}
            className="self-start"
          >
            Reset to {baseName}
          </Button>
        ))}
    </div>
  );
}
