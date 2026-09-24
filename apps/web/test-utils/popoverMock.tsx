import { cloneElement, createContext, useContext, type ReactElement, type ReactNode } from 'react';

/** A stand-in for `@base-ui/react/popover` in unit tests:
 *  `vi.mock('@base-ui/react/popover', () => import('@/test-utils/popoverMock'))`.
 *  The real Popover reads its state through `use-sync-external-store/shim`,
 *  a CommonJS file whose `require('react')` escapes vitest's React alias and
 *  lands on the repo root's React 18 ("reading 'useSyncExternalStore' of
 *  null"). This keeps the parts the app uses (controlled `open`, a trigger
 *  that toggles, a popup that renders only while open) and nothing else;
 *  the browser tests cover the real one. */

interface Ctx {
  open: boolean;
  setOpen: (open: boolean) => void;
}
const PopoverCtx = createContext<Ctx>({ open: false, setOpen: () => {} });

function Root({ open = false, onOpenChange, children }: { open?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode }) {
  return <PopoverCtx.Provider value={{ open, setOpen: (o) => onOpenChange?.(o) }}>{children}</PopoverCtx.Provider>;
}

function Trigger({
  render,
  children,
  disabled,
  ...rest
}: { render?: ReactElement<Record<string, unknown>>; children?: ReactNode; disabled?: boolean } & Record<string, unknown>) {
  const { open, setOpen } = useContext(PopoverCtx);
  const props = { ...rest, disabled, 'aria-expanded': open, onClick: () => setOpen(!open) };
  if (render) return cloneElement(render, props, children);
  return (
    <button type="button" {...props}>
      {children}
    </button>
  );
}

const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;

function Popup({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) {
  const { open } = useContext(PopoverCtx);
  if (!open) return null;
  const { className, ...attrs } = rest;
  return (
    <div role="dialog" className={className as string} {...attrs}>
      {children}
    </div>
  );
}

function Title({ children, className }: { children?: ReactNode; className?: string }) {
  return <h2 className={className}>{children}</h2>;
}

export const Popover = { Root, Trigger, Portal: Pass, Positioner: Pass, Popup, Title };
