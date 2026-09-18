import type { ReactNode } from 'react';
import { ChevronLeftIcon } from '@/components/icons';
import { PageTitle } from '@/components/page/PageTitle';
import { cn } from '@/lib/utils';

/** Where the notes came from, the small chip beside the meta line: "File
 *  added by Aron, shared". Presentational; `children` may replace the plain
 *  label with a menu trigger when there is more than one source. */
export function TabSourceChip({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <span
      data-testid="tab-source-chip"
      className="inline-flex items-center gap-inset rounded-full bg-card px-cluster py-inset text-xs text-muted-foreground"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-ember" />
      {children ?? label}
    </span>
  );
}

export interface TabSheetHeaderProps {
  phone: boolean;
  title: string;
  meta: string;
  /** The source chip (TabSourceChip), or nothing while there is no tab. */
  chip?: ReactNode;
  /** Top-right actions (add a file, generate, delete). */
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
      <PageTitle className={cn('mt-cluster', phone ? 'text-3xl!' : 'text-4xl!')}>{title}</PageTitle>
      <div className="mt-cluster flex flex-wrap items-center gap-x-row gap-y-cluster">
        {meta && <span className="text-meta">{meta}</span>}
        {chip}
      </div>
    </div>
  );
}
