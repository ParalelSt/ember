'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { BugIcon, RequestIcon } from '@/components/icons';
import { useUiStore } from '@/stores/useUiStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { cn } from '@/lib/utils';
import { SectionHeader } from '@/components/page/SectionHeader';
import { RequestDialog } from '@/components/RequestDialog';

export default function SettingsHelp() {
  const openBugReport = useUiStore((s) => s.setBugReportOpen);
  const [requestOpen, setRequestOpen] = useState(false);
  const autoReportEnabled = useSettingsStore((s) => s.autoReportEnabled);
  const setAutoReportEnabled = useSettingsStore((s) => s.setAutoReportEnabled);
  return (
    <section className="max-w-2xl">
      <SectionHeader title="Help" />
      <div className="mt-6 rounded-2xl bg-card p-6 shadow-soft">
        <div className="font-semibold">Report a bug</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Send your last session&apos;s diagnostics with an optional note. Goes straight to the project&apos;s Discord.
        </p>
        <Button onClick={() => openBugReport(true)} variant="ember" className="mt-4">
          <BugIcon className="h-4 w-4" />
          Report a bug
        </Button>
      </div>
      <div className="mt-6 rounded-2xl bg-card p-6 shadow-soft">
        <div className="font-semibold">Send a request</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Suggest a new feature or a fix. Goes straight to the project&apos;s Discord.
        </p>
        <Button onClick={() => setRequestOpen(true)} variant="ember" className="mt-4">
          <RequestIcon className="h-4 w-4" />
          Send a request
        </Button>
      </div>

      <div className="mt-4 rounded-2xl bg-card p-6 shadow-soft flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-semibold">Send crash reports automatically</div>
          <p className="mt-1 text-sm text-muted-foreground">
            When something crashes, quietly send the same diagnostics as the bug report dialog above (no note),
            capped at a few per session, so bugs get noticed even when nobody stops to report them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAutoReportEnabled(!autoReportEnabled)}
          aria-pressed={autoReportEnabled}
          aria-label={autoReportEnabled ? 'Turn off automatic crash reports' : 'Turn on automatic crash reports'}
          className={cn(
            'shrink-0 relative h-6 w-11 rounded-full transition-colors',
            autoReportEnabled ? 'bg-ember' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 left-0.5 h-5 w-5 rounded-full shadow-sm transition-transform',
              autoReportEnabled ? 'translate-x-5 bg-ember-foreground' : 'bg-foreground',
            )}
          />
        </button>
      </div>
      <RequestDialog open={requestOpen} onOpenChange={setRequestOpen} />
    </section>
  );
}
