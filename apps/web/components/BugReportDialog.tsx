'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useUiStore } from '@/stores/useUiStore';
import { logger } from '@/lib/logger/client';
import { readDesktopLog } from '@/lib/desktopLog';
import { detectShell } from '@/lib/playback/detectShell';
import { scrubText } from '@/lib/logger/sanitize';
import { NO_ANSWER_MESSAGE } from '@/lib/connectionBlip';
import { loadDeviceInfo } from '@/lib/versions/device';
import { AttachmentPicker } from '@/components/AttachmentPicker';
import {
  ATTACHMENT_FIELD,
  attachmentProblem,
  ATTACHMENTS_DROPPED_TOAST,
  PAYLOAD_FIELD,
} from '@/lib/attachments';

const MAX_NOTE = 1000;

export function BugReportDialog() {
  const open = useUiStore((s) => s.bugReportOpen);
  const setOpen = useUiStore((s) => s.setBugReportOpen);
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  // Snapshot is recomputed every render the dialog is open so the counts shown
  // reflect activity right up to the moment the user opens it.
  const counts = useMemo(() => {
    if (!open) return { current: 0, previous: 0, isDesktop: false };
    const s = logger.snapshot();
    return { current: s.current.length, previous: s.previous.length, isDesktop: detectShell() === 'tauri' };
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || attachmentProblem(files) !== null) return;
    setBusy(true);
    try {
      await loadDeviceInfo();
      const snapshot = logger.snapshot();
      // Desktop only, best effort: the shell's own log holds what the WebView
      // never sees. An empty string means there is nothing to attach.
      // The desktop shell's own log is unscrubbed native output (URLs,
      // headers, whatever the Rust side happened to print): run it through
      // the same secret patterns as the rest of the snapshot before it ever
      // leaves the device.
      const desktopLog = await readDesktopLog();
      if (desktopLog) snapshot.desktopLog = scrubText(desktopLog);
      const payload = JSON.stringify({ note: note.trim() || undefined, client: snapshot });
      // Plain JSON as before without files (lib/autoReport.ts always sends
      // that); with files, the same JSON as a `payload` part next to them.
      let body: BodyInit = payload;
      if (files.length > 0) {
        const form = new FormData();
        form.append(PAYLOAD_FIELD, payload);
        for (const f of files) form.append(ATTACHMENT_FIELD, f, f.name);
        body = form;
      }
      const res = await fetch('/api/bug-report', {
        method: 'POST',
        headers: files.length > 0 ? undefined : { 'Content-Type': 'application/json' },
        credentials: 'include',
        body,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
        throw new Error(err.error || `Failed: ${res.status}`);
      }
      // The route always answers JSON: anything else came from something in
      // its place (a Wi-Fi sign-in page), and the report never arrived. As
      // "Report sent" it cleared the note.
      const data = (await res.json().catch(() => null)) as {
        attachmentsDropped?: boolean;
      } | null;
      if (!data) throw new Error(NO_ANSWER_MESSAGE);
      if (data.attachmentsDropped) toast.warning(ATTACHMENTS_DROPPED_TOAST);
      else toast.success('Report sent');
      setNote('');
      setFiles([]);
      // The AI triage goes to the Discord channel only; the reporter just
      // gets the confirmation toast and the dialog closes.
      setOpen(false);
    } catch (e) {
      toast.error(`Couldn't send report: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onOpenChange = (o: boolean) => {
    if (!o) setFiles([]);
    setOpen(o);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report a bug</DialogTitle>
          <DialogDescription>
            Sends diagnostic logs to the host&apos;s Discord channel along with your note.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-2 flex flex-col gap-4">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
            placeholder="What happened? (optional)"
            rows={4}
          />
          <AttachmentPicker files={files} onChange={setFiles} disabled={busy} />
          <div className="text-xs text-muted-foreground">
            Diagnostic data: <span className="text-foreground">{counts.current}</span> events from this session,
            {' '}<span className="text-foreground">{counts.previous}</span> from your last session, app state
            {' '}(version, shell, route, current song), the last few minutes of server logs
            {counts.isDesktop ? ', and the desktop app log' : ''}.
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || attachmentProblem(files) !== null}
              variant="ember"
            >
              {busy ? 'Sending…' : 'Send report'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
