'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '@/lib/logger/client';

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
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh grid place-items-center px-6 text-center">
          <div className="max-w-md">
            <h1 className="text-2xl font-bold tracking-tight">Something broke</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              The error has been logged. Reload the page to recover, then{' '}
              <span className="text-foreground">Report a bug</span> from the menu if it keeps happening.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 inline-flex h-10 items-center rounded-md bg-ember px-4 text-sm font-semibold text-white hover:bg-ember-soft"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
