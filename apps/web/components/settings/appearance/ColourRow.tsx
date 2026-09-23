import { useState } from 'react';
import { RefreshIcon } from '@/components/icons';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { hexToOklch, isHex, oklchToHex, roundOklch, type Oklch } from '@/lib/theme/oklch';

export interface ColourRowProps {
  name: string;
  label: string;
  value: Oklch;
  /** More rows only: true while following the Basics, false once pinned.
   *  Undefined for a Basic, which has no pill. */
  auto?: boolean;
  readOnly?: boolean;
  onChange: (value: Oklch) => void;
  /** Unpin a More row, back to following the Basics. */
  onReset?: () => void;
}

/** One colour: the native picker as the swatch, a hex field (checked when
 *  it loses focus or on Enter) and, for a More row, an Auto / Reset pill. */
export function ColourRow({ name, label, value, auto, readOnly, onChange, onReset }: ColourRowProps) {
  const hex = oklchToHex(value);
  const [typed, setTyped] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    if (typed === null) return;
    const text = typed.trim();
    setTyped(null);
    if (!isHex(text)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const next = (text.startsWith('#') ? text : `#${text}`).toLowerCase();
    if (next !== hex) onChange(roundOklch(hexToOklch(next)));
  };

  return (
    <div data-testid="colour-row" data-key={name} className="flex flex-col gap-inset">
      <div className="flex items-center gap-row">
        <input
          type="color"
          aria-label={`${label} colour`}
          value={hex}
          disabled={readOnly}
          onChange={(e) => {
            setInvalid(false);
            onChange(roundOklch(hexToOklch(e.target.value)));
          }}
          className="size-hit shrink-0 cursor-pointer appearance-none rounded-full border border-border bg-transparent disabled:cursor-default [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
        />
        <label className="min-w-0 flex-1 text-sm font-medium" htmlFor={`hex-${name}`}>
          {label}
        </label>
        <Input
          id={`hex-${name}`}
          aria-label={`${label} hex`}
          aria-invalid={invalid || undefined}
          value={typed ?? hex}
          readOnly={readOnly}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          className="h-8 w-20 shrink-0 font-mono text-xs"
        />
        {auto !== undefined && (
          <button
            type="button"
            disabled={auto || readOnly}
            onClick={onReset}
            aria-label={auto ? `${label} follows the basics` : `Reset ${label} to follow the basics`}
            className={cn(
              'flex w-16 shrink-0 items-center justify-center gap-inset rounded-full border border-border px-cluster py-inset text-xs',
              auto ? 'text-muted-foreground' : 'text-foreground hover:bg-card',
            )}
          >
            {!auto && <RefreshIcon className="h-3 w-3" />}
            {auto ? 'Auto' : 'Reset'}
          </button>
        )}
      </div>
      {invalid && <p className="text-xs text-destructive">Use a colour like #1a2b3c.</p>}
    </div>
  );
}
