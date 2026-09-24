import { AlertIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Finding } from '@/lib/theme/guard';

/** "Muted text on cards: 2.4:1, hard to read" for a fail, "a little faint"
 *  for a warn. */
export function findingLine(f: Pick<Finding, 'label' | 'ratio' | 'level'>): string {
  return `${f.label}: ${f.ratio}:1, ${f.level === 'fail' ? 'hard to read' : 'a little faint'}`;
}

/** The guard's findings, one line each, with Fix it where the guard found
 *  a fix. Nothing is changed until the person presses it. */
export function ReadabilityNotes({
  findings,
  readOnly,
  onFix,
}: {
  findings: Finding[];
  readOnly?: boolean;
  onFix: (finding: Finding) => void;
}) {
  if (findings.length === 0) return null;
  return (
    <ul aria-label="Readability" className="flex flex-col gap-cluster">
      {findings.map((f) => (
        <li
          key={f.pair}
          data-testid="finding"
          data-level={f.level}
          className={cn(
            'flex items-center justify-between gap-row rounded-md border px-row py-inset text-xs',
            f.level === 'fail'
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-border bg-card text-muted-foreground',
          )}
        >
          <span className="flex items-center gap-cluster">
            <AlertIcon className="h-3.5 w-3.5 shrink-0" />
            {findingLine(f)}
          </span>
          {f.fix && !readOnly && (
            <Button size="xs" variant="outline" onClick={() => onFix(f)} className="shrink-0">
              Fix it
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
