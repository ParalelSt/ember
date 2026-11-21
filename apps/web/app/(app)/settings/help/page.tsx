'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { BugIcon, RequestIcon, SparklesIcon } from '@/components/icons';
import { useUiStore } from '@/stores/useUiStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { ToggleRow } from '@/components/ui/switch';
import { RequestDialog } from '@/components/RequestDialog';
import dynamic from 'next/dynamic';
import { uiSwitch } from '@/components/providers/uiSwitch';

function HelpCard({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div className="mt-6 rounded-2xl bg-card p-6 shadow-soft">
      <div className="font-semibold">{title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
      {children}
    </div>
  );
}

function NewSettingsHelp() {
  const openBugReport = useUiStore((s) => s.setBugReportOpen);
  const openIntro = useUiStore((s) => s.setIntroOpen);
  const [requestOpen, setRequestOpen] = useState(false);
  const autoReportEnabled = useSettingsStore((s) => s.autoReportEnabled);
  const setAutoReportEnabled = useSettingsStore((s) => s.setAutoReportEnabled);
  return (
    <section className="max-w-2xl">
      <HelpCard title="Report a bug" text="Send your last session's diagnostics with an optional note. Goes straight to the project's Discord.">
        <Button onClick={() => openBugReport(true)} variant="ember" className="mt-4">
          <BugIcon className="h-4 w-4" />
          Report a bug
        </Button>
      </HelpCard>
      <HelpCard title="Send a request" text="Suggest a new feature or a fix. Goes straight to the project's Discord.">
        <Button onClick={() => setRequestOpen(true)} variant="ember" className="mt-4">
          <RequestIcon className="h-4 w-4" />
          Send a request
        </Button>
      </HelpCard>
      <HelpCard title="Tour the new design" text="A quick look at what changed and where things moved.">
        <Button onClick={() => openIntro(true)} variant="ember" className="mt-4">
          <SparklesIcon className="h-4 w-4" />
          Tour the new design
        </Button>
      </HelpCard>

      <ToggleRow
        rowClassName="mt-4 rounded-2xl bg-card p-6 shadow-soft flex items-start justify-between gap-4"
        checked={autoReportEnabled}
        onCheckedChange={setAutoReportEnabled}
        aria-label={autoReportEnabled ? 'Turn off automatic crash reports' : 'Turn on automatic crash reports'}
      >
        <div className="min-w-0">
          <div className="font-semibold">Send crash reports automatically</div>
          <p className="mt-1 text-sm text-muted-foreground">
            When something crashes, quietly send the same diagnostics as the bug report dialog above (no note),
            capped at a few per session, so bugs get noticed even when nobody stops to report them.
          </p>
        </div>
      </ToggleRow>
      <RequestDialog open={requestOpen} onOpenChange={setRequestOpen} />
    </section>
  );
}

/** The Classic look's page (docs/classic-look.md), loaded only on a
 *  device that chose it. */
const LegacySettingsHelp = dynamic(() => import('@legacy/app/settings/help/page'));

export default uiSwitch(NewSettingsHelp, LegacySettingsHelp);
