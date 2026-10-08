'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { canScan } from '@/lib/qrScan/canScan';
import { approvePath, type ScannedCredential } from '@/lib/qrScan/parseScanned';
import { useUiStore } from '@/stores/useUiStore';

export const DEVICES_PATH = '/settings/devices';

/** Whether to offer "Scan QR code" here (lib/qrScan/canScan). False on the
 *  server and the first render, so nothing flashes or mismatches. */
export function useCanScan(): boolean {
  return useSyncExternalStore(noSubscribe, canScan, () => false);
}

// The answer never changes while the page is open.
const noSubscribe = () => () => {};

/** Where a scanned sign-in code goes: a QR link's token to the approve page
 *  (/link/<token>, which swaps itself for plain /link as soon as it has read
 *  the token), a short code to Settings > Devices, which shows the same
 *  approve card as typing it. `replace` when the scanner's own history entry
 *  is the one to replace (QrScanHost). */
export function useOpenScanned() {
  const router = useRouter();
  const setScannedCode = useUiStore((s) => s.setScannedCode);
  return useCallback(
    (credential: ScannedCredential, how: 'push' | 'replace' = 'push') => {
      const go = (path: string) => (how === 'replace' ? router.replace(path) : router.push(path));
      if (credential.kind === 'token') {
        go(approvePath(credential.token));
        return;
      }
      setScannedCode(credential.code);
      go(DEVICES_PATH);
    },
    [router, setScannedCode],
  );
}
