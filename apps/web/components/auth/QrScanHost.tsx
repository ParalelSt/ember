'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { QrScanner } from '@/components/auth/QrScanner';
import { DEVICES_PATH, useOpenScanned } from '@/hooks/useQrScan';
import { nativeScanQr } from '@/lib/qrScan/nativeScan';
import { NOT_A_SIGN_IN_CODE, parseScanned, type ScannedCredential } from '@/lib/qrScan/parseScanned';
import { useUiStore } from '@/stores/useUiStore';

const MARK = '__emberQrScan';

const markIsCurrent = () =>
  !!(typeof window !== 'undefined' && (window.history.state as Record<string, unknown> | null)?.[MARK]);

/** Mounted once in the app shell; ScanQrButton only sets qrScan.
 *
 *  'native': the Android app's own scanner (Google's code scanner, its own
 *  screen). A sign-in code navigates, anything else says "That's not an
 *  Ember sign-in code", Back/cancel does nothing. Unavailable (iOS app,
 *  browsers, old APKs, no Play services) moves on to 'web'.
 *
 *  'web': the page's scanner, full screen. Back closes it (its own history
 *  entry, like useBackDismiss). A result REPLACES that entry with the
 *  approve page, so nothing is left to go back to and no history.back()
 *  races the navigation. */
export function QrScanHost() {
  const mode = useUiStore((s) => s.qrScan);
  const setMode = useUiStore((s) => s.setQrScan);
  const openScanned = useOpenScanned();
  const router = useRouter();

  useEffect(() => {
    if (mode !== 'native') return;
    let cancelled = false;
    void nativeScanQr().then((answer) => {
      if (cancelled) return;
      if (answer.status === 'unavailable') {
        setMode('web');
        return;
      }
      setMode('idle');
      if (answer.status === 'cancelled') return;
      const credential = parseScanned(answer.value, window.location.origin);
      if (credential) openScanned(credential);
      else toast.error(NOT_A_SIGN_IN_CODE);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, setMode, openScanned]);

  useEffect(() => {
    if (mode !== 'web') return;
    window.history.pushState({ [MARK]: true }, '', window.location.href);
    const onPop = () => setMode('idle');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [mode, setMode]);

  const close = useCallback(() => {
    setMode('idle');
    if (markIsCurrent()) window.history.back();
  }, [setMode]);

  const onResult = useCallback(
    (credential: ScannedCredential) => {
      setMode('idle');
      openScanned(credential, markIsCurrent() ? 'replace' : 'push');
    },
    [setMode, openScanned],
  );

  const onTypeCode = useCallback(() => {
    setMode('idle');
    if (markIsCurrent()) router.replace(DEVICES_PATH);
    else router.push(DEVICES_PATH);
  }, [setMode, router]);

  if (mode !== 'web') return null;
  return <QrScanner onResult={onResult} onClose={close} onTypeCode={onTypeCode} />;
}
