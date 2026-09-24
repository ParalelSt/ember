'use client';

import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { CloseIcon, CopyToIcon } from '@/components/icons';
import { ShellPreview } from '@/components/library/options/changelog/ShellPreview';
import { cn } from '@/lib/utils';
import { formatCount } from '@/lib/format';
import type { CopyStepId } from '@/components/library/options/playlist-copy';
import { useCopyFlow, type CopyFlow } from '@/components/library/options/playlist-copy/flow';
import { useFrameScroll } from '@/components/library/options/playlist-copy/useFrameScroll';
import {
  BottomSheet,
  CenterDialog,
  CopyPageHeader,
  DestinationList,
  LikedWarning,
  ResultPanel,
  SortButton,
  SortChoices,
  TapRow,
} from '@/components/library/options/playlist-copy/parts';

/** The selection bar: it takes the top bar's place on a phone and sticks to
 *  the top of the page on desktop. */
function SelectionBar({ flow, phone }: { flow: CopyFlow; phone: boolean }) {
  const count = flow.picked.length;
  return (
    <div
      data-testid="copy-context-bar"
      className={cn(
        'relative z-10 flex items-center gap-inset bg-sidebar text-sidebar-foreground',
        phone ? 'border-b border-sidebar-border px-cluster py-cluster' : 'rounded-xl border border-border px-cluster py-cluster shadow-soft',
      )}
    >
      <button
        type="button"
        aria-label="Stop selecting"
        onClick={flow.exit}
        className="grid size-hit shrink-0 place-items-center rounded-lg hover:bg-muted"
      >
        <CloseIcon className="size-5" />
      </button>
      <span data-testid="copy-selection-count" className="min-w-0 flex-1 truncate text-base font-semibold">
        {flow.allSelected ? `All ${flow.total} selected` : `${count} selected`}
      </span>
      <button
        type="button"
        data-testid="copy-select-all"
        onClick={flow.toggleAll}
        className="h-10 shrink-0 rounded-full px-row text-sm font-medium hover:bg-muted"
      >
        {flow.allSelected ? 'Clear all' : 'Select all'}
      </button>
      <SortButton sort={flow.sort} open={flow.sortOpen} onClick={() => flow.setSortOpen(!flow.sortOpen)} iconOnly />
      <Button
        variant="ember"
        disabled={count === 0}
        onClick={() => flow.setPickerOpen(!flow.pickerOpen)}
        data-testid="copy-to"
        aria-label="Copy to…"
        className="h-10 shrink-0 rounded-full px-row"
      >
        <CopyToIcon className="size-4" />
        Copy
      </Button>
      {!phone && flow.sortOpen && (
        <div className="absolute right-section top-full z-20 mt-cluster w-80 rounded-xl border border-border bg-popover p-cluster text-popover-foreground shadow-soft">
          <SortChoices sort={flow.sort} onChange={flow.setSort} />
        </div>
      )}
      {!phone && flow.pickerOpen && (
        <div className="absolute right-0 top-full z-20 mt-cluster w-80 rounded-xl border border-border bg-popover p-cluster text-popover-foreground shadow-soft">
          <div className="px-cluster pb-cluster pt-inset text-sm font-semibold">Copy {formatCount(count, 'song')} to</div>
          <DestinationList picked={flow.picked} onChoose={flow.choose} />
        </div>
      )}
    </div>
  );
}

/** Candidate (b), "Tap to select", phone-first: press and hold a song (or
 *  tap its cover) to start; the top bar becomes the selection bar with
 *  Select all, Sort and Copy; sheets slide up for the rest, and the result
 *  is a snackbar. */
export function TapSelect({ phone, step }: { phone: boolean; step: CopyStepId }) {
  const flow = useCopyFlow(step);
  const listRef = useRef<HTMLDivElement>(null);
  useFrameScroll(listRef, phone && step !== 'start' && step !== 'result');

  const content = (
    <div data-testid="copy-candidate-tap-select" className="flex flex-col gap-stack">
      {!phone && flow.selecting && (
        <div className="sticky top-0 z-10">
          <SelectionBar flow={flow} phone={false} />
        </div>
      )}
      <CopyPageHeader phone={phone} />
      <div ref={listRef} className={cn(flow.result && 'pb-section')}>
        {!flow.selecting && (
          <div className="flex items-center justify-between gap-row border-b border-border px-row pb-cluster">
            <span data-testid="copy-hint" className="min-w-0 truncate text-sm text-muted-foreground">
              {phone ? 'Hold a song to select it' : 'Click a cover to select songs'}
            </span>
            <SortButton sort={flow.sort} open={flow.sortOpen} onClick={() => flow.setSortOpen(!flow.sortOpen)} />
          </div>
        )}
        <div className="flex flex-col pt-cluster">
          {flow.tracks.map((t) => (
            <TapRow
              key={t.id}
              track={t}
              selected={flow.isSelected(t.id)}
              selecting={flow.selecting}
              onToggle={() => flow.toggle(t.id)}
              phone={phone}
            />
          ))}
        </div>
      </div>
    </div>
  );

  const overlay = flow.result ? (
    <div className={cn('absolute inset-x-0 bottom-0 z-10 flex justify-center', phone ? 'px-cluster pb-cluster' : 'px-page-lg pb-block')}>
      <div
        data-testid="copy-snackbar"
        className="w-full max-w-xl rounded-xl border border-border bg-popover px-block py-row text-popover-foreground shadow-soft"
      >
        <ResultPanel result={flow.result} onDone={flow.dismissResult} compact />
      </div>
    </div>
  ) : null;

  const count = flow.picked.length;
  let modal = null;
  if (flow.confirm) {
    modal = phone ? (
      <BottomSheet onClose={flow.cancelConfirm}>
        <LikedWarning picked={flow.picked} plan={flow.likedPlan} onConfirm={flow.confirmLiked} onCancel={flow.cancelConfirm} stacked />
      </BottomSheet>
    ) : (
      <CenterDialog onClose={flow.cancelConfirm}>
        <LikedWarning picked={flow.picked} plan={flow.likedPlan} onConfirm={flow.confirmLiked} onCancel={flow.cancelConfirm} />
      </CenterDialog>
    );
  } else if (phone && flow.pickerOpen) {
    modal = (
      <BottomSheet title={`Copy ${formatCount(count, 'song')} to`} onClose={() => flow.setPickerOpen(false)} tall>
        <DestinationList picked={flow.picked} onChoose={flow.choose} />
      </BottomSheet>
    );
  } else if ((phone || !flow.selecting) && flow.sortOpen) {
    modal = phone ? (
      <BottomSheet title="Sort by" onClose={() => flow.setSortOpen(false)}>
        <SortChoices sort={flow.sort} onChange={flow.setSort} />
      </BottomSheet>
    ) : (
      <CenterDialog title="Sort by" onClose={() => flow.setSortOpen(false)}>
        <SortChoices sort={flow.sort} onChange={flow.setSort} />
      </CenterDialog>
    );
  }

  return (
    <ShellPreview
      phone={phone}
      activePath="/playlist/mock-1"
      content={content}
      topBar={phone && flow.selecting ? <SelectionBar flow={flow} phone /> : undefined}
      overlay={overlay}
      modal={modal}
    />
  );
}
