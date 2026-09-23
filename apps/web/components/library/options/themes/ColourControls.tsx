import { RefreshIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import { formatOklch, type Oklch, type ThemeInputsMock } from '@/components/library/options/themes/mock';
import { ReadabilityFinding } from '@/components/library/options/themes/ReadabilityFinding';
import { ShareToggleRow } from '@/components/library/options/themes/ShareToggleRow';

interface Row {
  key: keyof ThemeInputsMock;
  label: string;
}

const BASICS: Row[] = [
  { key: 'background', label: 'Background' },
  { key: 'accent', label: 'Accent' },
  { key: 'text', label: 'Text' },
];

const MORE: Row[] = [
  { key: 'surface', label: 'Surface' },
  { key: 'mutedText', label: 'Muted text' },
  { key: 'accentHover', label: 'Accent hover' },
  { key: 'border', label: 'Border' },
  { key: 'sidebar', label: 'Sidebar' },
];

/** One colour row: a swatch (the native `<input type="color">` in the real
 *  editor, a plain circle here since it opens a browser picker this
 *  gallery cannot mock), the label, and the OKLCH value. `pinned` More
 *  rows get "Reset"; everything else following the Basics gets "Auto"
 *  (section 1a: a touched More row is pinned until Reset). */
function ColourRow({ row, value, pinned }: { row: Row; value: Oklch; pinned?: boolean }) {
  return (
    <div className="flex items-center gap-row" data-testid="colour-row" data-key={row.key}>
      <span
        aria-hidden
        data-testid="swatch"
        className="size-hit shrink-0 rounded-full border border-border bg-(--swatch-bg)"
        style={{ ['--swatch-bg' as string]: formatOklch(value) }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{row.label}</div>
        <div className="truncate text-xs text-muted-foreground">{formatOklch(value)}</div>
      </div>
      {MORE.includes(row) && (
        <button
          type="button"
          className={cn(
            'flex shrink-0 items-center gap-inset rounded-full border border-border px-cluster py-inset text-xs',
            pinned ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {pinned && <RefreshIcon className="h-3 w-3" />}
          {pinned ? 'Reset' : 'Auto'}
        </button>
      )}
    </div>
  );
}

export interface ColourControlsProps {
  inputs: ThemeInputsMock;
  /** More rows the person has touched (section 1a): pinned until Reset,
   *  otherwise following the Basics. */
  pinned?: ReadonlySet<keyof ThemeInputsMock>;
  showWarning?: boolean;
  onFixIt?: () => void;
  /** A shared theme in use: read-only, with a note instead of the Share
   *  toggle (only its owner can edit, rename, unshare or delete it). */
  readOnly?: boolean;
  ownerName?: string;
  shared?: boolean;
  /** Inspector layout gives Share its own tab; every other layout shows
   *  the toggle right under the rows. */
  hideShareToggle?: boolean;
  className?: string;
}

/** The eight colour rows (Basics, then More), the readability findings and
 *  the "Share with everyone" toggle: everything Settings > Appearance's
 *  right-hand colour panel needs, laid out the same way regardless of
 *  which layout candidate is hosting it. */
export function ColourControls({
  inputs,
  pinned = new Set(),
  showWarning,
  onFixIt,
  readOnly,
  ownerName,
  shared,
  hideShareToggle,
  className,
}: ColourControlsProps) {
  return (
    <div data-testid="colour-controls" className={cn('flex flex-col gap-stack', className)}>
      {readOnly && ownerName && (
        <p data-testid="colour-controls-readonly-note" className="text-xs text-muted-foreground">
          Shared by {ownerName}. Only {ownerName} can edit, rename, unshare or delete it; use{' '}
          <span className="font-medium text-foreground">Copy to my themes</span> to make an editable copy.
        </p>
      )}
      <div className="flex flex-col gap-row">
        <div className="text-eyebrow">Basics</div>
        {BASICS.map((row) => (
          <ColourRow key={row.key} row={row} value={inputs[row.key]} />
        ))}
      </div>
      <div className="flex flex-col gap-row">
        <div className="text-eyebrow">More</div>
        {MORE.map((row) => (
          <ColourRow key={row.key} row={row} value={inputs[row.key]} pinned={pinned.has(row.key)} />
        ))}
      </div>
      {showWarning && <ReadabilityFinding onFixIt={onFixIt} />}
      {!readOnly && !hideShareToggle && <ShareToggleRow checked={!!shared} />}
    </div>
  );
}
