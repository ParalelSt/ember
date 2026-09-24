'use client';

import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { CopyToIcon, SelectIcon } from '@/components/icons';
import { ShellPreview } from '@/components/library/options/changelog/ShellPreview';
import { cn } from '@/lib/utils';
import { formatCount } from '@/lib/format';
import type { CopyStepId } from '@/components/library/options/playlist-copy';
import { useCopyFlow } from '@/components/library/options/playlist-copy/flow';
import { useFrameScroll } from '@/components/library/options/playlist-copy/useFrameScroll';
import {
  BottomSheet,
  BrowseList,
  CenterDialog,
  Checkbox,
  CheckboxRow,
  CopyPageHeader,
  DestinationList,
  LikedWarning,
  PillButton,
  ResultPanel,
  SortButton,
  SortChoices,
  SortHeading,
  allState,
  selectGrid,
} from '@/components/library/options/playlist-copy/parts';

/** Candidate (a), "Checkbox column": Select in the action bar turns the
 *  play column into checkboxes; Select all and Sort sit in a row above the
 *  list; a bar sticks to the bottom with the count and Copy to…, and the
 *  result lands in that same bar. */
export function CheckboxColumn({ phone, step }: { phone: boolean; step: CopyStepId }) {
  const flow = useCopyFlow(step);
  const listRef = useRef<HTMLDivElement>(null);
  useFrameScroll(listRef, phone && step !== 'start' && step !== 'result');
  const count = flow.picked.length;
  const bar = flow.selecting || flow.result;

  const content = (
    <div data-testid="copy-candidate-checkbox-bar" className="flex flex-col gap-stack">
      <CopyPageHeader
        phone={phone}
        actions={
          <PillButton onClick={flow.selecting ? flow.exit : flow.enter} active={flow.selecting} testId="copy-enter">
            <SelectIcon className="size-4" />
            {flow.selecting ? 'Done' : 'Select'}
          </PillButton>
        }
      />

      <div ref={listRef} className={cn(bar && 'pb-section')}>
        <div data-testid="copy-list-toolbar" className="relative flex min-h-12 items-center justify-between gap-row border-b border-border px-row pb-cluster">
          {flow.selecting ? (
            <div className="flex min-w-0 items-center gap-cluster">
              <Checkbox
                checked={allState(count, flow.total)}
                onChange={flow.toggleAll}
                label={flow.allSelected ? 'Clear selection' : 'Select all'}
              />
              <button
                type="button"
                data-testid="copy-select-all"
                onClick={flow.toggleAll}
                className="truncate text-sm font-medium hover:underline"
              >
                {flow.allSelected ? 'Clear all' : 'Select all'}
              </button>
              <span className="truncate text-sm text-muted-foreground">
                {count} of {flow.total}
              </span>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">{formatCount(flow.total, 'song')}</span>
          )}
          <SortButton sort={flow.sort} open={flow.sortOpen} onClick={() => flow.setSortOpen(!flow.sortOpen)} />
          {!phone && flow.sortOpen && (
            <div className="absolute right-0 top-full z-20 w-80 rounded-xl border border-border bg-popover p-cluster shadow-soft">
              <SortChoices sort={flow.sort} onChange={flow.setSort} />
            </div>
          )}
        </div>

        {flow.selecting ? (
          <div className="flex flex-col">
            {!phone && (
              <div className={cn('grid items-center gap-row px-row py-cluster', selectGrid(false))}>
                <span />
                <div className="flex min-w-0 items-center gap-block">
                  <SortHeading label="Title" sortKey="title" sort={flow.sort} onChange={flow.setSort} />
                  <SortHeading label="Artist" sortKey="artist" sort={flow.sort} onChange={flow.setSort} />
                </div>
                <span className="text-eyebrow">Album</span>
                <SortHeading label="Added" sortKey="added" sort={flow.sort} onChange={flow.setSort} />
                <SortHeading label="Time" sortKey="duration" sort={flow.sort} onChange={flow.setSort} className="justify-self-end" />
              </div>
            )}
            {flow.tracks.map((t) => (
              <CheckboxRow key={t.id} track={t} selected={flow.isSelected(t.id)} onToggle={() => flow.toggle(t.id)} phone={phone} />
            ))}
          </div>
        ) : (
          <div className="pt-cluster">
            <BrowseList tracks={flow.tracks} nowLiked={flow.result?.destination.kind === 'liked' ? flow.result.plan.add : undefined} />
          </div>
        )}
      </div>
    </div>
  );

  const overlay = bar ? (
    <div className={cn('absolute inset-x-0 bottom-0 z-10 flex justify-center', phone ? 'px-cluster pb-cluster' : 'px-page-lg pb-block')}>
      <div
        data-testid="copy-bottom-bar"
        className="relative w-full max-w-2xl rounded-xl border border-border bg-popover px-block py-row text-popover-foreground shadow-soft"
      >
        {flow.result ? (
          <ResultPanel result={flow.result} onDone={flow.dismissResult} compact />
        ) : (
          <div className="flex items-center gap-row">
            <span data-testid="copy-selection-count" className="min-w-0 flex-1 truncate text-sm font-semibold">
              {count === 0 ? 'Pick songs to copy' : `${count} selected`}
            </span>
            {count > 0 && (
              <Button variant="ghost" onClick={flow.clear} className="h-10 rounded-full px-row">
                Clear
              </Button>
            )}
            <Button
              variant="ember"
              disabled={count === 0}
              onClick={() => flow.setPickerOpen(!flow.pickerOpen)}
              data-testid="copy-to"
              className="h-10 rounded-full px-block"
            >
              <CopyToIcon className="size-4" />
              Copy to…
            </Button>
          </div>
        )}
        {!phone && flow.pickerOpen && (
          <div className="absolute bottom-full right-0 z-20 mb-cluster w-80 rounded-xl border border-border bg-popover p-cluster shadow-soft">
            <div className="px-cluster pb-cluster pt-inset text-sm font-semibold">Copy {formatCount(count, 'song')} to</div>
            <DestinationList picked={flow.picked} onChoose={flow.choose} />
          </div>
        )}
      </div>
    </div>
  ) : null;

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
  } else if (phone && flow.sortOpen) {
    modal = (
      <BottomSheet title="Sort by" onClose={() => flow.setSortOpen(false)}>
        <SortChoices sort={flow.sort} onChange={flow.setSort} />
      </BottomSheet>
    );
  }

  return <ShellPreview phone={phone} activePath="/playlist/mock-1" content={content} overlay={overlay} modal={modal} />;
}
