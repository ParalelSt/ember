import type { ReactNode } from 'react';
import { ChevronLeftIcon } from '@/components/icons';
import { PageTitle } from '@/components/page/PageTitle';
import { cn } from '@/lib/utils';

export interface TabSheetHeaderProps {
  phone: boolean;
  title: string;
  meta: string;
  /** Beside the meta line, when there is something to show there. */
  chip?: ReactNode;
  /** Top-right actions (add a file, search again, delete). */
  actions?: ReactNode;
  onBack?: () => void;
}

/** The full header of a song with no tab yet: Back and the ⋯ menu, the
 *  "Guitar tab" eyebrow, the song title, then the meta line. (A drawn tab
 *  has the stage's thin title line instead, TabStage.tsx.) */
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
