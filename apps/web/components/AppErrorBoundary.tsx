'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertIcon } from '@/components/icons';
import { EmptyState } from '@/components/page/EmptyState';
import { logger } from '@/lib/logger/client';
import { useUiStore } from '@/stores/useUiStore';

interface State {
  hasError: boolean;
}

/** Catches render errors anywhere under it, logs them, shows a minimal
 *  fallback. Production-mode crash recovery; in dev the React overlay still
 *  shows on top of this. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('react', error.message || 'render error', { componentStack: info.componentStack }, error);
  }

  render(): ReactNode {
    if (this.state.hasError) return <CrashFallback onReload={() => window.location.reload()} />;
    return this.props.children;
  }
}

/** What a crash shows instead of the app (this boundary) or instead of the
 *  page under the app shell (app/(app)/error.tsx, which keeps the sidebar,
 *  the player and the menu). `onReload`: the full reload here, Next's
 *  retry of the page there. Report a bug opens the one dialog, which the
 *  root layout mounts beside this boundary, so a crash here leaves it up. */
export function CrashFallback({ onReload }: { onReload: () => void }) {
  const openBugReport = useUiStore((s) => s.setBugReportOpen);
  return (
    <div className="min-h-dvh grid place-items-center px-page">
      <EmptyState
        icon={<AlertIcon />}
        title="Something broke"
        titleAs="h1"
        action={{ label: 'Try again', onClick: onReload }}
        secondaryAction={{ label: 'Report a bug', onClick: () => openBugReport(true) }}
      >
        Try again, and report it if it keeps happening.
      </EmptyState>
    </div>
  );
}
