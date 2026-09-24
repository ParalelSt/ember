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
import { AttachmentPicker } from '@/components/AttachmentPicker';
import {
  ATTACHMENT_FIELD,
  attachmentProblem,
  ATTACHMENTS_DROPPED_TOAST,
  PAYLOAD_FIELD,
} from '@/lib/attachments';

const MAX_NOTE = 1000;

interface Triage {
  summary: string;
  likelyCause: string;
  area: string;
  severity: 'low' | 'medium' | 'high';
  confidence: 'low' | 'medium' | 'high';
  nextSteps: string[];
  reproduction: string;
}

const SEVERITY_STYLE: Record<Triage['severity'], string> = {
  low: 'bg-emerald-500/15 text-emerald-400',
  medium: 'bg-amber-500/15 text-amber-400',
  high: 'bg-red-500/15 text-red-400',
};

export function BugReportDialog() {
  const open = useUiStore((s) => s.bugReportOpen);
  const setOpen = useUiStore((s) => s.setBugReportOpen);
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [triage, setTriage] = useState<Triage | null>(null);

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
      const data = (await res.json().catch(() => ({}))) as {
        triage?: Triage | null;
        attachmentsDropped?: boolean;
      };
      if (data.attachmentsDropped) toast.warning(ATTACHMENTS_DROPPED_TOAST);
      else toast.success('Report sent');
      setNote('');
      setFiles([]);
      // With AI triage on, stay open to show the diagnosis; without it there's
      // nothing to show, so close as before.
      if (data.triage) setTriage(data.triage);
      else setOpen(false);
    } catch (e) {
      toast.error(`Couldn't send report: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setOpen(false);
    setTriage(null);
    setFiles([]);
  };

  const onOpenChange = (o: boolean) => {
    if (!o) setFiles([]);
    setOpen(o);
  };

  if (triage) {
    return (
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report sent</DialogTitle>
            <DialogDescription>Here&apos;s what the logs look like from our side.</DialogDescription>
          </DialogHeader>
          <div className="mt-2 flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${SEVERITY_STYLE[triage.severity]}`}>
                {triage.severity}
              </span>
              <span className="rounded bg-card px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {triage.area}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {triage.confidence} confidence
              </span>
            </div>
            <p>{triage.summary}</p>
            <p className="text-muted-foreground">
              <span className="text-foreground">Reproduce: </span>
              {triage.reproduction}
            </p>
            <p className="text-muted-foreground">{triage.likelyCause}</p>
            {triage.nextSteps.length > 0 && (
              <ul className="list-disc pl-4 text-muted-foreground">
                {triage.nextSteps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              This is an automated guess from the logs, not a verdict. The full report is with the host.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" onClick={close} variant="ember">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

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
