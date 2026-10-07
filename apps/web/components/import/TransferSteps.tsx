import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronRightIcon, EditIcon, FileIcon, KeyIcon, LinkIcon } from '@/components/icons';
import { stepFrame, type StepFrame } from '@/lib/import/transferIllustrations';
import type { TransferRoute, TransferRouteKind } from '@/lib/import/transferRoutes';
import { cn } from '@/lib/utils';

// The middle of the Transfer page: "What do you have already?" as big rows,
// then the chosen way's steps one at a time, each beside a small picture of
// the screen to tap. Presentational: data in, callbacks out.

const KIND_ICON: Record<TransferRouteKind, typeof FileIcon> = {
  file: FileIcon,
  paste: EditIcon,
  link: LinkIcon,
  google: KeyIcon,
};

/** The ways in a service offers, each with what it asks of you and how
 *  long it takes. */
export function HaveOptions({ choices, onPick }: { choices: readonly TransferRoute[]; onPick: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-cluster" data-testid="transfer-have-options">
      {choices.map((r) => {
        const Icon = KIND_ICON[r.kind];
        return (
          <button
            key={r.id}
            type="button"
            data-testid="transfer-have-option"
            data-route={r.id}
            onClick={() => onPick(r.id)}
            className="flex w-full items-center gap-row rounded-2xl border border-border bg-card p-row text-left transition-colors hover:border-ember"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ember/15 text-ember">
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span data-testid="transfer-have-label" className="block text-sm font-semibold">
                {r.whatYouHave}
              </span>
              <span className="block text-xs text-muted-foreground">{r.time}</span>
            </span>
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        );
      })}
    </div>
  );
}

/** A mini mock of the screen a step happens on: the app's name, the
 *  screen's title, its rows, the one to tap outlined with a pulsing dot. */
export function StepIllustration({ frame }: { frame: StepFrame }) {
  return (
    <div
      data-testid="transfer-illustration"
      aria-hidden="true"
      className="w-full max-w-60 rounded-2xl border border-border bg-popover p-row shadow-lg"
    >
      <div className="flex items-center gap-inset text-[10.5px] font-semibold tracking-wide text-muted-foreground">
        <span className="size-2.5 rounded-[3px]" style={{ background: frame.color }} />
        {frame.app}
      </div>
      <div className="mb-inset mt-cluster text-[13px] font-bold">{frame.title}</div>
      {frame.rows.map((row, i) => (
        <div
          key={row}
          data-tap={i === frame.tap ? 'true' : undefined}
          className={cn(
            'relative mt-inset rounded-lg px-cluster py-cluster pr-7 text-[11.5px]',
            i === frame.tap ? 'bg-ember/10 outline-2 outline-ember' : 'bg-foreground/5',
          )}
        >
          {row}
          {i === frame.tap && (
            <span className="absolute right-cluster top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-ember ember-tap" />
          )}
        </div>
      ))}
    </div>
  );
}

/** One step of a way in at a time: its picture, where it is ("Step 2 of
 *  4") with a dot per step, the sentence, then Back and Next step, or on
 *  the last step the real control that takes the file, the list, the link
 *  or the Google sign-in. */
export function StepCard({
  route,
  step,
  onStep,
  control,
}: {
  route: TransferRoute;
  step: number;
  onStep: (step: number) => void;
  /** What goes where Next step would be on the last step. */
  control: ReactNode;
}) {
  const n = route.steps.length;
  const i = Math.min(Math.max(step, 0), n - 1);
  const last = i === n - 1;
  const frame = stepFrame(route.id, i);
  return (
    <div data-testid="transfer-steps" data-step={i} className="flex flex-col gap-row">
      {frame && (
        <div className="grid place-items-center rounded-2xl border border-border bg-card p-block">
          <StepIllustration frame={frame} />
        </div>
      )}
      <div className="flex items-center justify-between gap-cluster">
        <span className="text-eyebrow">
          Step {i + 1} of {n}
        </span>
        <div className="flex items-center gap-inset">
          {route.steps.map((_, k) => (
            <button
              key={k}
              type="button"
              aria-label={`Step ${k + 1}`}
              aria-current={k === i ? 'step' : undefined}
              onClick={() => onStep(k)}
              className={cn('h-2 rounded-full transition-all', k === i ? 'w-4.5 bg-ember' : 'w-2 bg-muted-foreground/40')}
            />
          ))}
        </div>
      </div>
      <p data-testid="transfer-step-text" className="text-sm leading-relaxed">
        {route.steps[i]}
      </p>
      {last ? (
        control
      ) : (
        <>
          <div className="flex items-center gap-cluster">
            <Button type="button" variant="outline" disabled={i === 0} onClick={() => onStep(i - 1)} className="h-10">
              Back
            </Button>
            <Button type="button" variant="ember" onClick={() => onStep(i + 1)} className="h-10 flex-1">
              Next step
            </Button>
          </div>
          <button
            type="button"
            onClick={() => onStep(n - 1)}
            className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            I have it already, skip to the end
          </button>
        </>
      )}
      {route.notes.map((note) => (
        <p key={note} className="text-xs text-muted-foreground">
          {note}
        </p>
      ))}
    </div>
  );
}
