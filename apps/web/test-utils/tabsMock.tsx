import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';

/** Stand-in for `@/components/ui/tabs` in unit tests (the real one is
 *  base-ui's Tabs, which reads its state through a CommonJS shim that lands on
 *  the repo root's React 18, see popoverMock.tsx). Controlled `value`, real
 *  tab roles and aria-selected.
 *
 *    vi.mock('@/components/ui/tabs', () => import('@/test-utils/tabsMock')); */
const Ctx = createContext<{ value?: string; onValueChange?: (v: string) => void }>({});

export function Tabs({ value, onValueChange, children }: { value?: string; onValueChange?: (v: string) => void; children?: ReactNode }) {
  return <Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>;
}

export function TabsList({ variant, children, ...rest }: ComponentProps<'div'> & { variant?: string }) {
  return (
    <div role="tablist" data-variant={variant} {...rest}>
      {children}
    </div>
  );
}

export function TabsTrigger({ value, children }: { value: string; children?: ReactNode }) {
  const tabs = useContext(Ctx);
  return (
    <button type="button" role="tab" aria-selected={tabs.value === value} onClick={() => tabs.onValueChange?.(value)}>
      {children}
    </button>
  );
}
