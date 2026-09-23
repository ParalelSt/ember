import { SearchIcon } from '@/components/icons';

/** Height of the mock keyboard, in CSS px: about what Gboard takes on a
 *  390px phone with its suggestion strip. */
export const KEYBOARD_PX = 248;

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function Key({ label, wide = false }: { label: string; wide?: boolean }) {
  return (
    <span
      className={
        wide
          ? 'grid h-10 flex-[1.5] place-items-center rounded-md bg-white/15 text-xs text-white/85'
          : 'grid h-10 flex-1 place-items-center rounded-md bg-white/25 text-base text-white'
      }
    >
      {label}
    </span>
  );
}

/** Android's on-screen keyboard, drawn over the bottom of the mock phone the
 *  way the real one comes up over a page: a suggestion strip and four rows
 *  of keys, with a search key where Enter goes. Pure picture: nothing in it
 *  is pressable. `bottom` is where it sits: above the system navigation
 *  strip when the frame has one. */
export function MockKeyboard({ bottom, suggestions }: { bottom: number; suggestions: string[] }) {
  return (
    <div
      data-testid="mock-keyboard"
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 z-30 flex flex-col gap-cluster bg-neutral-800 px-inset pb-cluster"
      style={{ bottom, height: KEYBOARD_PX }}
    >
      <div className="flex h-9 items-center justify-around border-b border-white/10 text-sm text-white/80">
        {suggestions.map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
      {ROWS.map((row, i) => (
        <div key={row} className="flex gap-inset px-inset">
          {i === 2 && <Key label="⇧" wide />}
          {[...row].map((c) => (
            <Key key={c} label={c} />
          ))}
          {i === 2 && <Key label="⌫" wide />}
        </div>
      ))}
      <div className="flex gap-inset px-inset">
        <Key label="?123" wide />
        <Key label="," />
        <span className="h-10 flex-[5] rounded-md bg-white/25" />
        <Key label="." />
        <span className="grid h-10 flex-[1.5] place-items-center rounded-md bg-ember text-ember-foreground">
          <SearchIcon className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}
