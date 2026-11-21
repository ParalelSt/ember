'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { RequestDialog } from '@/components/RequestDialog';
import { RedesignIntro } from '@/components/intro/RedesignIntro';
import { introBlockedPath, introSeen } from '@/lib/redesignIntro';
import { useUiStore } from '@/stores/useUiStore';

/** Settle time after the app opens, and how often to look again while
 *  something else is open (ms). */
export const INTRO_DELAY_MS = 800;
export const INTRO_RETRY_MS = 1500;

/** Another modal or sheet is up (update dialog, bug report, a sheet...). */
function otherModalOpen(): boolean {
  const s = useUiStore.getState();
  if (s.bugReportOpen || s.searchOpen || s.qrScan !== 'idle' || s.approveRequest) return true;
  return document.querySelector('[role="dialog"]:not([data-redesign-intro]), [role="alertdialog"]') !== null;
}

/** Opens the "new design" intro once per device, on the first app open for a
 *  signed-in user (never over sign-in, link or legal pages, never over another
 *  modal), and again whenever Settings asks (Help > Tour the new design). Also
 *  owns the request dialog its last step opens on the Fix tab. */
export function RedesignIntroHost() {
  const { user } = useAuth();
  const pathname = usePathname();
  const open = useUiStore((s) => s.introOpen);
  const setOpen = useUiStore((s) => s.setIntroOpen);
  const [requestOpen, setRequestOpen] = useState(false);
  const blocked = introBlockedPath(pathname);

  useEffect(() => {
    if (!user || blocked || introSeen()) return;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      if (introSeen()) return;
      if (otherModalOpen()) timer = setTimeout(attempt, INTRO_RETRY_MS);
      else setOpen(true);
    };
    timer = setTimeout(attempt, INTRO_DELAY_MS);
    return () => clearTimeout(timer);
  }, [user, blocked, setOpen]);

  return (
    <>
      <RedesignIntro
        open={open}
        onClose={() => setOpen(false)}
        onFixRequest={() => {
          setOpen(false);
          setRequestOpen(true);
        }}
      />
      <RequestDialog open={requestOpen} onOpenChange={setRequestOpen} initialKind="fix" />
    </>
  );
}
