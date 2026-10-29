import { createContext, useContext, useState, type ComponentProps, type ReactNode } from 'react';

/** A stand-in for `@/components/ui/dropdown-menu` in unit tests:
 *  `vi.mock('@/components/ui/dropdown-menu', () => import('@/test-utils/dropdownMenuMock'))`.
 *  It keeps what the app's menus rely on: the trigger toggles, the content
 *  renders only while open (as `role="menu"`, with its own props), and an
 *  item runs its onClick and closes the menu. */
const Ctx = createContext<{ open: boolean; setOpen: (o: boolean) => void }>({ open: false, setOpen: () => {} });

export function DropdownMenu({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
}

export function DropdownMenuTrigger({ children, ...rest }: ComponentProps<'button'>) {
  const { open, setOpen } = useContext(Ctx);
  return (
    <button type="button" aria-expanded={open} {...rest} onClick={() => setOpen(!open)}>
      {children}
    </button>
  );
}

type ContentProps = ComponentProps<'div'> & { align?: string; side?: string; sideOffset?: number };

/** Positioning props are the real popup's business: dropped here. */
function divProps<T extends Record<string, unknown>>(props: T, drop: string[]) {
  return Object.fromEntries(Object.entries(props).filter(([k]) => !drop.includes(k)));
}

export function DropdownMenuContent({ children, ...rest }: ContentProps) {
  const { open } = useContext(Ctx);
  if (!open) return null;
  return (
    <div role="menu" {...divProps(rest, ['align', 'side', 'sideOffset'])}>
      {children}
    </div>
  );
}

export function DropdownMenuItem({ children, onClick, ...rest }: ComponentProps<'div'> & { variant?: string }) {
  const { setOpen } = useContext(Ctx);
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      {...divProps(rest, ['variant'])}
      onClick={(e) => {
        onClick?.(e);
        setOpen(false);
      }}
    >
      {children}
    </div>
  );
}

export function DropdownMenuSeparator() {
  return <hr />;
}
