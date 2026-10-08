'use client';

import { Button } from '@/components/ui/button';
import { ScanQrIcon } from '@/components/icons';
import { useCanScan } from '@/hooks/useQrScan';
import { useUiStore } from '@/stores/useUiStore';
import { cn } from '@/lib/utils';

export const SCAN_QR_LABEL = 'Scan QR code';

/** "Scan QR code", where scanning makes sense (useCanScan: a phone or tablet,
 *  never the desktop app or a car screen); renders nothing elsewhere.
 *  `nav` looks like a menu row (Sidebar, Drawer), `button` like an outline
 *  button (Settings > Devices). `onBeforeStart` closes a drawer first. */
export function ScanQrButton({
  look = 'button',
  onBeforeStart,
  className,
}: {
  look?: 'button' | 'nav';
  onBeforeStart?: () => void;
  className?: string;
}) {
  const can = useCanScan();
  const setQrScan = useUiStore((s) => s.setQrScan);
  if (!can) return null;

  const onClick = () => {
    onBeforeStart?.();
    // QrScanHost (in the app shell) takes it from here.
    setQrScan('native');
  };

  if (look === 'nav') {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid="scan-qr"
        className={cn(
          'flex w-full items-center gap-row rounded-md px-row py-cluster text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
          className,
        )}
      >
        <ScanQrIcon className="h-4 w-4" />
        {SCAN_QR_LABEL}
      </button>
    );
  }
  return (
    <Button type="button" variant="outline" onClick={onClick} data-testid="scan-qr" className={className}>
      <ScanQrIcon />
      {SCAN_QR_LABEL}
    </Button>
  );
}
