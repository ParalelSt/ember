import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ role: 'admin', failure: null as Error | null }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  const requireUser = async () => {
    if (state.failure) throw state.failure;
    if (state.role === 'anon') throw new actual.UnauthorizedError();
    return { user: { isAdmin: state.role === 'admin' } };
  };
  return { ...actual, requireUser, requireAdmin: async () => {
    const ctx = await requireUser();
    if (!ctx.user.isAdmin) throw new actual.ForbiddenError();
    return ctx;
  } };
});
vi.mock('@/hooks/useAdmin', () => ({
  useQueryAdminBackups: () => ({ isLoading: true }),
  useExecuteBackupNow: () => ({ isPending: false }),
}));
vi.mock('next/link', () => ({ default: ({ children, ...rest }: ComponentProps<'a'>) => <a {...rest}>{children}</a> }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/backups',
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
}));
vi.mock('./backups/BackupsPanel', () => ({ default: () => <div>Backup controls</div> }));
const { default: AdminLayout } = await import('./layout');
const { default: BackupsPage } = await import('./backups/page');

beforeEach(() => { state.role = 'admin'; state.failure = null; });

for (const [name, renderPage] of [
  ['admin navigation', () => AdminLayout({ children: <div>Admin content</div> })],
  ['backup page', async () => BackupsPage()],
] as const) {
  describe(name, () => {
    it.each([['member', '/'], ['anon', name === 'backup page' ? '/auth?next=/admin/backups' : '/auth?next=/admin']])(
      'refuses %s on the server', async (role, target) => {
        state.role = role;
        await expect(renderPage()).rejects.toThrow(`redirect:${target}`);
      },
    );
    it('fails closed if authorization is unavailable', async () => {
      state.failure = new Error('Authorization unavailable');
      await expect(renderPage()).rejects.toThrow('Authorization unavailable');
    });
  });
}

it('renders the backup nav entry and page for an admin', async () => {
  render(await AdminLayout({ children: await BackupsPage() }));
  expect(screen.getByRole('link', { name: 'Backups' })).toHaveAttribute('href', '/admin/backups');
  expect(screen.getByText('Backup controls')).toBeInTheDocument();
});
