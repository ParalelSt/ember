'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertIcon, CheckIcon, ChevronLeftIcon, CloseIcon, MusicIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import {
  PLAINWORDS_SERVICES,
  plainResultCopy,
  routeById,
  type PlainWordsCandidateId,
  type PlainWordsRoute,
  type PlainWordsService,
  type PlainWordsServiceId,
  type PlainWordsStateId,
} from '@/components/library/options/plainwords';

/** The friendly dead end: the chosen route needs a desktop browser, this
 *  frame is a phone. Says so plainly and, when another route exists,
 *  offers it instead rather than leaving a person stuck. */
function DesktopOnlyDeadEnd({ service, route, onSwitch }: { service: PlainWordsService; route: PlainWordsRoute; onSwitch: () => void }) {
  const other = service.routes.find((r) => r.id !== route.id && !r.desktopOnly);
  return (
    <div data-testid="plainwords-dead-end" className="flex flex-col gap-row rounded-lg border border-border bg-card p-row">
      <div className="flex items-center gap-cluster text-sm font-semibold">
        <AlertIcon className="h-4 w-4 text-muted-foreground" />
        This one needs a computer
      </div>
      <p className="text-xs text-muted-foreground">
        {route.label} needs a desktop browser, and this looks like a phone. Come back to this on a computer, or use
        another way in.
      </p>
      {other && (
        <Button type="button" variant="secondary" size="sm" onClick={onSwitch} className="self-start">
          Use &ldquo;{other.label}&rdquo; instead
        </Button>
      )}
    </div>
  );
}

function StepsList({ route }: { route: PlainWordsRoute }) {
  return (
    <div data-testid="plainwords-steps" className="flex flex-col gap-cluster">
      <ol className="flex flex-col gap-inset text-xs text-muted-foreground">
        {route.steps.map((step, i) => (
          <li key={i}>
            {i + 1}. {step}
          </li>
        ))}
      </ol>
      {route.note && <p className="text-xs text-muted-foreground">{route.note}</p>}
      {route.cap && <p className="text-xs text-muted-foreground">Only the first {route.cap} songs come across this way.</p>}
    </div>
  );
}

function ResultCard({ route }: { route: PlainWordsRoute }) {
  const clean = route.check === 0 && route.notFound === 0;
  return (
    <div data-testid="plainwords-result" className="flex flex-col gap-cluster rounded-lg border border-border bg-card p-row">
      <div className="flex items-center gap-cluster text-sm font-semibold">
        <CheckIcon className={cn('h-4 w-4', clean ? 'text-ember' : 'text-muted-foreground')} />
        Done
      </div>
      <p className="text-sm">{plainResultCopy(route)}</p>
    </div>
  );
}

/** State prop the parent controls, plus every service the picker can flip
 *  between: the "asking" screen shows all four, highlighting whichever the
 *  service picker currently names. */
export interface PlainWordsDialogProps {
  candidate: PlainWordsCandidateId;
  service: PlainWordsServiceId;
  state: PlainWordsStateId;
  phone: boolean;
}

/** One candidate's Transfer dialog, drawn as an absolutely positioned
 *  overlay inside ShellPreview's `modal` slot, same shape as the shipped
 *  dialog's own markup (components/import/TransferDialog.tsx) and the
 *  earlier Task-0 candidates (options/transfer/DestinationStep.tsx). Local
 *  state only picks which route within a service to show; the owner's
 *  service and state pickers on /dizajn drive everything else, so the key
 *  the section mounts this with must change on every (candidate, service)
 *  pair for that local state to reset. */
export function PlainWordsDialog({ candidate, service: serviceId, state, phone }: PlainWordsDialogProps) {
  const service = PLAINWORDS_SERVICES.find((s) => s.id === serviceId) ?? PLAINWORDS_SERVICES[0];
  const [pickedRouteId, setPickedRouteId] = useState<string | null>(null);
  const [showOtherWays, setShowOtherWays] = useState(false);

  const hasChoice = service.routes.length > 1 && candidate !== 'one-way';
  // Only the "steps" screen makes someone answer the choice; landing
  // straight on "Result" (the owner's picker can jump there) falls back to
  // the first route rather than stranding the frame on an unanswered
  // question.
  const needsPick = hasChoice && pickedRouteId === null && state === 'steps';
  const route = routeById(service, pickedRouteId);
  const deadEnd = phone && route.desktopOnly && state !== 'asking' && !needsPick;

  return (
    <div className="absolute inset-0 z-40" data-testid="plainwords-dialog" data-candidate={candidate} data-service={serviceId} data-state={state}>
      <div className="absolute inset-0 bg-black/10 backdrop-blur-xs" />
      <div
        role="dialog"
        aria-label="Bring in your music"
        className={cn(
          'absolute top-1/2 left-1/2 flex max-h-[90%] w-full -translate-x-1/2 -translate-y-1/2 flex-col gap-block overflow-y-auto rounded-xl bg-popover p-block text-sm text-popover-foreground ring-1 ring-foreground/10',
          phone ? 'max-w-[calc(100%-2rem)]' : 'max-w-lg',
        )}
      >
        <div className="flex items-center gap-cluster pr-stack">
          <MusicIcon className="h-4 w-4 text-ember" />
          <div className="font-heading text-base leading-none font-medium">
            {state === 'asking' ? 'Bring in your music' : `Bring in your ${service.name} songs`}
          </div>
        </div>

        {state !== 'asking' && (
          <div className="flex items-center gap-inset text-xs text-muted-foreground">
            <ChevronLeftIcon className="h-3.5 w-3.5" />
            {service.name}
          </div>
        )}

        {state === 'asking' && (
          <div className="flex flex-col gap-row">
            <p className="text-xs text-muted-foreground">Where is your music now?</p>
            <div className="grid grid-cols-2 gap-row">
              {PLAINWORDS_SERVICES.map((s) => (
                <div
                  key={s.id}
                  data-testid="plainwords-service-card"
                  data-service={s.id}
                  aria-pressed={s.id === serviceId}
                  className={cn(
                    'rounded-lg border p-row text-left text-sm font-medium',
                    s.id === serviceId ? 'border-ember bg-ember/10' : 'border-border',
                  )}
                >
                  {s.name}
                </div>
              ))}
            </div>
          </div>
        )}

        {needsPick && candidate === 'two-way' && (
          <div data-testid="plainwords-choice" className="flex flex-col gap-row">
            <div className="grid gap-row sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setPickedRouteId(service.routes[0].id)}
                className="flex flex-col gap-inset rounded-lg border border-border p-row text-left transition-colors hover:border-ember hover:bg-accent/40"
              >
                <span className="text-sm font-semibold">The quick way</span>
                <span className="text-xs text-muted-foreground">{service.routes[0].tradeoff}</span>
              </button>
              <button
                type="button"
                onClick={() => setPickedRouteId(service.routes[1].id)}
                className="flex flex-col gap-inset rounded-lg border border-border p-row text-left transition-colors hover:border-ember hover:bg-accent/40"
              >
                <span className="text-sm font-semibold">The exact way</span>
                <span className="text-xs text-muted-foreground">{service.routes[1].tradeoff}</span>
              </button>
            </div>
          </div>
        )}

        {needsPick && candidate === 'what-you-have' && (
          <div data-testid="plainwords-choice" className="flex flex-col gap-row">
            <p className="text-xs text-muted-foreground">What do you have already?</p>
            <div className="flex flex-col gap-cluster">
              {service.routes.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setPickedRouteId(r.id)}
                  className="rounded-lg border border-border p-row text-left text-sm font-medium transition-colors hover:border-ember hover:bg-accent/40"
                >
                  {r.whatYouHave}
                </button>
              ))}
            </div>
          </div>
        )}

        {state !== 'asking' && !needsPick && (
          <>
            {deadEnd ? (
              <DesktopOnlyDeadEnd service={service} route={route} onSwitch={() => setPickedRouteId(service.routes.find((r) => r.id !== route.id)?.id ?? route.id)} />
            ) : (
              <>
                {state === 'steps' && <StepsList route={route} />}
                {state === 'result' && <ResultCard route={route} />}
              </>
            )}
            {candidate === 'one-way' && service.routes.length > 1 && (
              <div data-testid="plainwords-other-ways">
                {!showOtherWays ? (
                  <button type="button" onClick={() => setShowOtherWays(true)} className="text-xs text-muted-foreground underline">
                    Other ways in
                  </button>
                ) : (
                  <div className="flex flex-col gap-inset">
                    <span className="text-xs text-muted-foreground">Other ways in:</span>
                    {service.routes
                      .filter((r) => r.id !== route.id)
                      .map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setPickedRouteId(r.id)}
                          className="self-start text-xs text-foreground underline"
                        >
                          {r.label}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="-mx-block -mb-block mt-cluster flex justify-end gap-cluster rounded-b-xl border-t bg-muted/50 p-block">
          <Button variant="ghost">Cancel</Button>
          {state === 'result' && !deadEnd && (
            <Button className="bg-ember text-white hover:bg-ember-soft">Bring these in</Button>
          )}
        </div>
        <Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" aria-label="Close">
          <CloseIcon />
        </Button>
      </div>
    </div>
  );
}
