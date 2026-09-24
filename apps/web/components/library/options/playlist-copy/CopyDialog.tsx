'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeftIcon, CloseIcon, CopyToIcon } from '@/components/icons';
import { ShellPreview } from '@/components/library/options/changelog/ShellPreview';
import { cn } from '@/lib/utils';
import { formatCount } from '@/lib/format';
import type { CopyStepId } from '@/components/library/options/playlist-copy';
import { useCopyFlow, type CopyFlow } from '@/components/library/options/playlist-copy/flow';
import { MOCK_COPY_SOURCE_NAME } from '@/components/library/options/playlist-copy/mock';
import {
  Backdrop,
  BrowseList,
  Checkbox,
  CopyPageHeader,
  DestinationList,
  DialogRow,
  LikedWarning,
  PillButton,
  ResultPanel,
  SortButton,
  SortChoices,
  allState,
} from '@/components/library/options/playlist-copy/parts';

type DialogStep = 'pick' | 'where' | 'liked' | 'result';

function dialogStep(flow: CopyFlow): DialogStep {
  if (flow.result) return 'result';
  if (flow.confirm) return 'liked';
  if (flow.pickerOpen) return 'where';
  return 'pick';
}

/** The dialog's frame: centred on desktop, the whole screen on a phone. */
function DialogFrame({
  phone,
  title,
  onBack,
  onClose,
  footer,
  children,
  step,
}: {
  phone: boolean;
  title: string;
  onBack?: () => void;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  step: DialogStep;
}) {
  const head = (
    <div className="flex items-center gap-cluster">
      {onBack && (
        <button type="button" aria-label="Back" onClick={onBack} className="grid size-hit shrink-0 place-items-center rounded-lg hover:bg-muted md:size-8">
          <ChevronLeftIcon className="size-5" />
        </button>
      )}
      <div className="min-w-0 flex-1 truncate text-base font-semibold">{title}</div>
      <button type="button" aria-label="Close" onClick={onClose} className="grid size-hit shrink-0 place-items-center rounded-lg hover:bg-muted md:size-8">
        <CloseIcon className="size-5" />
      </button>
    </div>
  );
  const body = (
    <div
      role="dialog"
      aria-label={title}
      data-testid="copy-dialog"
      data-step={step}
      className={cn(
        'relative flex min-h-0 flex-col gap-block bg-popover text-popover-foreground',
        phone ? 'h-full w-full px-block pt-row pb-block' : 'max-h-[88%] w-2xl max-w-[92%] rounded-xl border border-border p-stack shadow-soft',
      )}
    >
      {head}
      <div className="flex min-h-0 flex-1 flex-col gap-block">{children}</div>
      {footer}
    </div>
  );
  if (phone) return <div className="absolute inset-0 z-40">{body}</div>;
  return (
    <div className="absolute inset-0 z-40 grid place-items-center">
      <Backdrop onClose={onClose} />
      {body}
    </div>
  );
}

/** Candidate (c), "Copy songs dialog": one button on the page opens a
 *  dialog with its own list, checkboxes and sort; where to, the Liked
 *  warning and the result are steps inside it. The page never changes. */
export function CopyDialog({ phone, step }: { phone: boolean; step: CopyStepId }) {
  const flow = useCopyFlow(step);
  const count = flow.picked.length;
  const open = flow.selecting || !!flow.result;
  const at = dialogStep(flow);

  const content = (
    <div data-testid="copy-candidate-copy-dialog" className="flex flex-col gap-stack">
      <CopyPageHeader
        phone={phone}
        actions={
          <PillButton onClick={flow.enter} testId="copy-enter">
            <CopyToIcon className="size-4" />
            Copy songs
          </PillButton>
        }
      />
      <BrowseList tracks={flow.tracks} nowLiked={flow.result?.destination.kind === 'liked' ? flow.result.plan.add : undefined} />
    </div>
  );

  let modal = null;
  if (open && at === 'pick') {
    modal = (
      <DialogFrame
        phone={phone}
        step={at}
        title={`Copy songs from ${MOCK_COPY_SOURCE_NAME}`}
        onClose={flow.exit}
        footer={
          <div className="flex items-center justify-end gap-cluster">
            {!phone && (
              <Button variant="ghost" onClick={flow.exit} className="h-10 rounded-full px-block">
                Cancel
              </Button>
            )}
            <Button
              variant="ember"
              disabled={count === 0}
              onClick={() => flow.setPickerOpen(true)}
              data-testid="copy-to"
              className={cn('h-10 rounded-full px-block', phone && 'w-full')}
            >
              <CopyToIcon className="size-4" />
              {count === 0 ? 'Pick songs to copy' : `Copy ${formatCount(count, 'song')} to…`}
            </Button>
          </div>
        }
      >
        <div className="flex items-center justify-between gap-row border-b border-border pb-cluster">
          <div className="flex min-w-0 items-center gap-cluster">
            <Checkbox checked={allState(count, flow.total)} onChange={flow.toggleAll} label={flow.allSelected ? 'Clear selection' : 'Select all'} />
            <button type="button" data-testid="copy-select-all" onClick={flow.toggleAll} className="truncate text-sm font-medium hover:underline">
              {flow.allSelected ? 'Clear all' : 'Select all'}
            </button>
            <span data-testid="copy-selection-count" className="truncate text-sm text-muted-foreground">
              {count} of {flow.total}
            </span>
          </div>
          <SortButton sort={flow.sort} open={flow.sortOpen} onClick={() => flow.setSortOpen(!flow.sortOpen)} />
        </div>
        {flow.sortOpen && (
          <div className="rounded-xl border border-border p-cluster">
            <SortChoices sort={flow.sort} onChange={flow.setSort} />
          </div>
        )}
        <div className="-mx-cluster min-h-0 flex-1 overflow-y-auto">
          {flow.tracks.map((t) => (
            <DialogRow key={t.id} track={t} selected={flow.isSelected(t.id)} onToggle={() => flow.toggle(t.id)} />
          ))}
        </div>
      </DialogFrame>
    );
  } else if (open && at === 'where') {
    modal = (
      <DialogFrame phone={phone} step={at} title={`Copy ${formatCount(count, 'song')} to`} onBack={() => flow.setPickerOpen(false)} onClose={flow.exit}>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DestinationList picked={flow.picked} onChoose={flow.choose} />
        </div>
      </DialogFrame>
    );
  } else if (open && at === 'liked') {
    const back = () => {
      flow.cancelConfirm();
      flow.setPickerOpen(true);
    };
    modal = (
      <DialogFrame phone={phone} step={at} title="Add to Liked songs" onBack={back} onClose={flow.exit}>
        <LikedWarning picked={flow.picked} plan={flow.likedPlan} onConfirm={flow.confirmLiked} onCancel={back} stacked={phone} />
      </DialogFrame>
    );
  } else if (open && at === 'result' && flow.result) {
    modal = (
      <DialogFrame phone={phone} step={at} title="Copied" onClose={flow.dismissResult}>
        <ResultPanel result={flow.result} onDone={flow.dismissResult} />
      </DialogFrame>
    );
  }

  return <ShellPreview phone={phone} activePath="/playlist/mock-1" content={content} modal={modal} />;
}
