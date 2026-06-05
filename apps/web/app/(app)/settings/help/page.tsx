'use client';

import { Button } from '@/components/ui/button';
import { BugIcon } from '@/components/icons';
import { useUiStore } from '@/stores/useUiStore';

export default function SettingsHelp() {
  const openBugReport = useUiStore((s) => s.setBugReportOpen);
  return (
    <section className="max-w-2xl">
      <h2 className="text-xl font-bold tracking-tight">Help</h2>
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
    </section>
  );
}
