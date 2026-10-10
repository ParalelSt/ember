'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ApproveSheet } from '@/components/auth/ApproveSheet';
import { DEVICES_PATH } from '@/hooks/useQrScan';
import type { QrFacts } from '@/lib/qrLogin/client';
import { useUiStore, type JustApproved } from '@/stores/useUiStore';

export const SHEET_MARK = '__emberApproveSheet';
/** QrScanHost's own history entry for the page scanner. */
export const SCAN_MARK = '__emberQrScan';

const historyMark = () =>
  typeof window === 'undefined' ? null : ((window.history.state as Record<string, unknown> | null) ?? null);
const sheetIsCurrent = () => !!historyMark()?.[SHEET_MARK];

export function justApprovedFrom(facts: QrFacts): JustApproved {
  return { id: facts.id, device: facts.device, sameNetwork: facts.sameNetwork, at: Date.now() };
}

/** Mounted once in the app shell: the approve sheet for a request opened by
 *  Scan QR code or typed in Settings > Devices (useUiStore.openApprove).
 *
 *  Back closes it: it has its own history entry, the same URL as the page
 *  under it. When the page scanner (QrScanHost) is what read the code, its
 *  entry is taken over instead of a second one pushed, so one Back still
 *  leaves. Approving REPLACES that entry with Settings > Devices (no back()
 *  racing the navigation), where the new device is lit up. */
export function ApproveSheetHost() {
  const request = useUiStore((s) => s.approveRequest);
  const closeApprove = useUiStore((s) => s.closeApprove);
  const setJustApproved = useUiStore((s) => s.setJustApproved);
  const router = useRouter();
  const pathname = usePathname();
  const open = !!request;

  // A link inside the sheet (Have a code?) went to another page: the sheet
  // was about this one, so it goes (adjusted during render, React's pattern
  // for state that follows an outside value).
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  if (open && openedOn === null) setOpenedOn(pathname);
  if (!open && openedOn !== null) setOpenedOn(null);
  useEffect(() => {
    if (open && openedOn !== null && pathname !== openedOn) closeApprove();
  }, [open, openedOn, pathname, closeApprove]);

  useEffect(() => {
    if (!open) return;
    const state = historyMark();
    if (state?.[SCAN_MARK]) window.history.replaceState({ [SHEET_MARK]: true }, '', window.location.href);
    else if (!state?.[SHEET_MARK]) window.history.pushState({ [SHEET_MARK]: true }, '', window.location.href);
    const onPop = () => closeApprove();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [open, closeApprove]);

  const close = useCallback(() => {
    closeApprove();
    if (sheetIsCurrent()) window.history.back();
  }, [closeApprove]);

  const onApproved = useCallback(
    (facts: QrFacts) => {
      setJustApproved(justApprovedFrom(facts));
      closeApprove();
      if (pathname === DEVICES_PATH) {
        // Already there: the list lights the device up; just drop the entry.
        if (sheetIsCurrent()) window.history.back();
      } else if (sheetIsCurrent()) router.replace(DEVICES_PATH);
      else router.push(DEVICES_PATH);
    },
    [setJustApproved, closeApprove, pathname, router],
  );

  if (!request) return null;
  return <ApproveSheet key={request.n} credential={request.credential} onClose={close} onApproved={onApproved} />;
}
