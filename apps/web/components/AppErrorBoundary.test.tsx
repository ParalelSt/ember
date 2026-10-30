import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useUiStore } from '@/stores/useUiStore';

const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), breadcrumb: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/logger/client', () => ({ logger }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));

const { AppErrorBoundary } = await import('./AppErrorBoundary');

function Bomb(): ReactNode {
  throw new Error('boom');
}

const crash = () =>
  render(
    <AppErrorBoundary>
      <Bomb />
    </AppErrorBoundary>,
  );

beforeEach(() => {
  logger.error.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useUiStore.setState({ bugReportOpen: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useUiStore.setState({ bugReportOpen: false });
});

describe('AppErrorBoundary', () => {
  it('shows the icon, title, one line and two buttons side by side, and logs', () => {
    crash();
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Something broke' })).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Try again' });
    const report = screen.getByRole('button', { name: 'Report a bug' });
    expect(retry.parentElement).toBe(report.parentElement);
    expect(retry.parentElement?.className).toContain('flex');
    expect(logger.error).toHaveBeenCalledWith('react', 'boom', expect.anything(), expect.any(Error));
  });

  it('claims nothing the code does not guarantee', () => {
    const { container } = crash();
    expect(container.textContent).not.toMatch(/safe|saved|logged|lost|sent/i);
  });

  it('Try again does the full reload it always did', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    crash();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('Report a bug opens the bug dialog through the store, with no reload', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    crash();
    fireEvent.click(screen.getByRole('button', { name: 'Report a bug' }));
    expect(useUiStore.getState().bugReportOpen).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('the dialog that opens is mounted outside the boundary, so a crash cannot take it down', () => {
    const layout = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8');
    const boundaryEnd = layout.indexOf('</AppErrorBoundary>');
    expect(boundaryEnd).toBeGreaterThan(-1);
    expect(layout.indexOf('<BugReportDialog />')).toBeGreaterThan(boundaryEnd);
  });
});
