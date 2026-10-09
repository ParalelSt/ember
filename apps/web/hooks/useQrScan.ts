'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { canScan } from '@/lib/qrScan/canScan';
import type { ScannedCredential } from '@/lib/qrScan/parseScanned';
import { useUiStore } from '@/stores/useUiStore';

export const DEVICES_PATH = '/settings/devices';

/** Whether to offer "Scan QR code" here (lib/qrScan/canScan). False on the
 *  server and the first render, so nothing flashes or mismatches. */
export function useCanScan(): boolean {
  return useSyncExternalStore(noSubscribe, canScan, () => false);
}

// The answer never changes while the page is open.
const noSubscribe = () => () => {};

/** What a scanned sign-in code opens: the approve sheet over the page that
 *  is open (ApproveSheetHost), for a QR link's token or a short code alike.
 *  Nothing navigates and the token never reaches the address bar. */
export function useOpenScanned() {
  const openApprove = useUiStore((s) => s.openApprove);
  return useCallback(
    (credential: ScannedCredential) => {
      openApprove(credential.kind === 'token' ? { token: credential.token } : { code: credential.code });
    },
    [openApprove],
  );
}
