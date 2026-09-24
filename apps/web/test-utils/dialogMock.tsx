import { createContext, useContext, type ReactNode } from 'react';

/** Stand-ins for `@/components/ui/dialog` and `@/components/ui/sheet` in
 *  unit tests (the real ones are base-ui's Dialog, which reads its state
 *  through a CommonJS shim that lands on the repo root's React 18, see
 *  popoverMock.tsx). Controlled `open`, a role="dialog" box while open, and
 *  Escape-free: tests close them through their own buttons.
 *
 *    vi.mock('@/components/ui/dialog', () => import('@/test-utils/dialogMock'));
 *    vi.mock('@/components/ui/sheet', () => import('@/test-utils/dialogMock')); */

const OpenCtx = createContext(false);

type RootProps = { open?: boolean; onOpenChange?: (open: boolean) => void; children?: ReactNode };
function Root({ open = false, children }: RootProps) {
  return <OpenCtx.Provider value={open}>{children}</OpenCtx.Provider>;
}

type ContentProps = { children?: ReactNode; className?: string; showCloseButton?: boolean; side?: string } & Record<string, unknown>;
function Content({ children, className, ...rest }: ContentProps) {
  const open = useContext(OpenCtx);
  if (!open) return null;
  // Drop the real component's own props; keep data-* and the like.
  const attrs = Object.fromEntries(Object.entries(rest).filter(([k]) => k !== 'showCloseButton' && k !== 'side'));
  return (
    <div role="dialog" className={className} {...attrs}>
      {children}
    </div>
  );
}

const Title = ({ children, className }: { children?: ReactNode; className?: string }) => <h2 className={className}>{children}</h2>;
const Description = ({ children, className }: { children?: ReactNode; className?: string }) => <p className={className}>{children}</p>;
const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;

export {
  Root as Dialog,
  Content as DialogContent,
  Title as DialogTitle,
  Description as DialogDescription,
  Pass as DialogHeader,
  Pass as DialogFooter,
  Root as Sheet,
  Content as SheetContent,
  Title as SheetTitle,
  Description as SheetDescription,
  Pass as SheetHeader,
  Pass as SheetFooter,
};
