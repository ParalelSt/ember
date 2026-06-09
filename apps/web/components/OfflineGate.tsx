'use client';

import type { ReactNode } from 'react';
import { useOnline } from '@/lib/useOnline';
import { OfflinePlaceholder } from '@/components/OfflinePlaceholder';

/** Wrap a route's body to swap in an offline placeholder when the network
 *  is unreachable. Server Components can still own the data fetch; this is
 *  the leaf client component that decides what to render. */
export function OfflineGate({ children }: { children: ReactNode }) {
  const isOnline = useOnline();
  if (!isOnline) return <OfflinePlaceholder />;
  return <>{children}</>;
}
