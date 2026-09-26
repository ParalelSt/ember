import type { ReactNode } from 'react';
import { ChevronLeftIcon } from '@/components/icons';
import { PageTitle } from '@/components/page/PageTitle';
import { cn } from '@/lib/utils';

/** Where the notes came from, the small chip beside the meta line: "File
 *  added by Aron, shared". Presentational; `children` may replace the plain
 *  label with a menu trigger when there is more than one source. Never wider
 *  than its row: a long label is cut with an ellipsis, whole in `title`. */
export function TabSourceChip({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <span
      data-testid="tab-source-chip"
      title={label}
      className="inline-flex max-w-full min-w-0 items-center gap-inset rounded-full bg-card px-cluster py-inset text-xs text-muted-foreground"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ember" />
      {children ?? <span className="min-w-0 truncate">{label}</span>}
    </span>
  );
}

export interface TabSheetHeaderProps {
  phone: boolean;
  title: string;
  meta: string;
  /** The source chip (TabSourceChip), or nothing while there is no tab. */
  chip?: ReactNode;
  /** Top-right actions (add a file, search again, delete). */
  actions?: ReactNode;
  onBack?: () => void;
}

/** The Sheet page header approved on /dizajn: Back, the "Guitar tab"
 *  eyebrow, the song title, then the meta line with bpm, key, instrument
 *  and tuning beside the source chip. */
export function TabSheetHeader({ phone, title, meta, chip, actions, onBack }: TabSheetHeaderProps) {
  return (
    <div data-testid="tab-sheet-header">
      <div className="mb-block flex items-center justify-between gap-row">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-inset text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeftIcon className="size-4" />
          Back
        </button>
        {actions && <div className="flex items-center gap-inset">{actions}</div>}
      </div>
      <div className="text-eyebrow">Guitar tab</div>
      <PageTitle className={cn('mt-cluster break-words', phone ? 'text-3xl!' : 'text-4xl!')}>{title}</PageTitle>
      <div className="mt-cluster flex min-w-0 flex-wrap items-center gap-x-row gap-y-cluster">
        {meta && <span className="text-meta min-w-0 break-words">{meta}</span>}
        {chip}
      </div>
    </div>
  );
}
