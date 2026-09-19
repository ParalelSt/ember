/** Presentational only: a circular progress indicator, an ember arc over a
 *  muted track. The import's sidebar row and progress banner use it. */
export function ProgressRing({
  done,
  total,
  size = 16,
  label = 'Import progress',
}: {
  done: number;
  total: number;
  size?: number;
  label?: string;
}) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <svg
      data-testid="import-progress-ring"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0 -rotate-90"
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={2.5} className="stroke-muted" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        className="stroke-ember transition-[stroke-dashoffset] duration-300"
      />
    </svg>
  );
}
