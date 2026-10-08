'use client';

import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CopyIcon, ShareIcon } from '@/components/icons';
import { legacyCopy } from '@/components/track/ShareButton';
import { QrSvg } from '@/components/ui/QrSvg';
import { carlistJoinUrl } from '@/lib/carlist';

/** The join link for a code, on whatever address this page was opened on. */
export function joinLinkFor(code: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return carlistJoinUrl(origin, code);
}

/** Copies the join link: clipboard, then the old way (plain http on a LAN
 *  address has no clipboard API), then says what to do instead. */
export async function copyJoinLink(code: string): Promise<void> {
  const link = joinLinkFor(code);
  try {
    await navigator.clipboard.writeText(link);
    toast.success('Join link copied');
    return;
  } catch {
    // Not a secure context: fall through.
  }
  if (legacyCopy(link)) toast.success('Join link copied');
  else toast.message(`Join code: ${code}`);
}

/** The carlist's QR: the shared QrSvg with its own label. */
export function QrCode({ value, size = 176, className }: { value: string; size?: number; className?: string }) {
  return <QrSvg value={value} size={size} className={className} label="QR code to join" />;
}

/** QR first (scan it in the car), then the link for chats, and the code
 *  small for reading aloud. */
export function CarlistSharePanel({ code }: { code: string }) {
  const link = joinLinkFor(code);
  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: 'Join my carlist', url: link });
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
    await copyJoinLink(code);
  };
  return (
    <div data-testid="carlist-share" className="flex flex-col items-center gap-block text-center">
      <QrCode value={link} />
      <div>
        <div className="text-sm font-semibold">Scan with the phone camera to join</div>
        <div className="mt-inset text-xs text-muted-foreground">
          or type the code{' '}
          <span data-testid="share-code" className="font-mono font-bold tracking-widest text-foreground">
            {code}
          </span>
        </div>
      </div>
      <div className="flex w-full gap-cluster">
        <Button variant="ember" className="h-10 flex-1" onClick={() => void copyJoinLink(code)}>
          <CopyIcon /> Copy link
        </Button>
        <Button variant="outline" className="h-10" onClick={() => void share()}>
          <ShareIcon /> Share
        </Button>
      </div>
      <div className="w-full truncate text-xs text-muted-foreground" data-testid="share-link">
        {link}
      </div>
    </div>
  );
}

export function CarlistShareDialog({
  code,
  open,
  onOpenChange,
}: {
  code: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Invite to the carlist</DialogTitle>
          <DialogDescription>Anyone who opens the link or scans the code joins and can add songs.</DialogDescription>
        </DialogHeader>
        <CarlistSharePanel code={code} />
      </DialogContent>
    </Dialog>
  );
}
