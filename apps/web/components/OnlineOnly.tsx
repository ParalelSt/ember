'use client';

import type { ReactNode } from 'react';
import { useOnline } from '@/lib/useOnline';
import { OfflinePlaceholder } from '@/components/OfflinePlaceholder';

/** Wrap a route's body so it renders only while the network is reachable;
 *  offline it swaps in the placeholder. Server Components can still own the
 *  data fetch; this is the leaf client component that decides what to
 *  render, in place of the guard every page used to repeat. */
export function OnlineOnly({ children }: { children: ReactNode }) {
  const isOnline = useOnline();
  if (!isOnline) return <OfflinePlaceholder />;
  return <>{children}</>;
}
