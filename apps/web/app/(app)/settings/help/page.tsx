'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { BugIcon, RequestIcon } from '@/components/icons';
import { useUiStore } from '@/stores/useUiStore';
import { SectionHeader } from '@/components/page/SectionHeader';
import { RequestDialog } from '@/components/RequestDialog';

export default function SettingsHelp() {
  const openBugReport = useUiStore((s) => s.setBugReportOpen);
  const [requestOpen, setRequestOpen] = useState(false);
  return (
    <section className="max-w-2xl">
      <SectionHeader title="Help" />
      <div className="mt-6 rounded-2xl bg-card p-6 shadow-soft">
        <div className="font-semibold">Report a bug</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Send your last session&apos;s diagnostics with an optional note. Goes straight to the project&apos;s Discord.
        </p>
        <Button onClick={() => openBugReport(true)} className="mt-4 bg-ember hover:bg-ember-soft text-white">
          <BugIcon className="h-4 w-4" />
          Report a bug
        </Button>
      </div>
      <div className="mt-6 rounded-2xl bg-card p-6 shadow-soft">
        <div className="font-semibold">Send a request</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Suggest a new feature or a fix. Goes straight to the project&apos;s Discord.
        </p>
        <Button onClick={() => setRequestOpen(true)} className="mt-4 bg-ember hover:bg-ember-soft text-white">
          <RequestIcon className="h-4 w-4" />
          Send a request
        </Button>
      </div>
      <RequestDialog open={requestOpen} onOpenChange={setRequestOpen} />
    </section>
  );
}
