import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

/** Register makes the account, then signs in with it: two calls. When the
 *  first one got through and the second did not (a dropped connection, the
 *  sign-in limit), the page stays on "Create your account", and pressing
 *  Register again used to fail for good on "email: The email is invalid or
 *  already in use.", the account the first press made. */

const create = vi.fn();
const authWithPassword = vi.fn();
const authStore = {
  token: '',
  isValid: false,
  record: null as Record<string, unknown> | null,
  save: vi.fn(),
  onChange: () => () => {},
  clear: vi.fn(),
};
vi.mock('@/lib/pocketbase/client', () => ({
  createClient: () => ({
    authStore,
    collection: () => ({ create, authWithPassword, authRefresh: vi.fn(async () => ({})) }),
    files: { getURL: () => '' },
  }),
}));
vi.mock('@/stores/usePrivacyStore', () => ({ usePrivacyStore: { getState: () => ({ load: vi.fn() }) } }));
vi.mock('@/stores/useChangelogStore', () => ({ useChangelogStore: { getState: () => ({ load: vi.fn() }), setState: vi.fn() } }));
vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ loadPlugins: vi.fn(), resetPluginSync: vi.fn() }) },
}));
vi.mock('@/stores/useThemeStore', () => ({
  useThemeStore: { getState: () => ({ loadTheme: vi.fn(async () => {}), resetThemeSync: vi.fn() }) },
  registerThemeCookieWriter: () => {},
}));
vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), breadcrumb: vi.fn(), warn: vi.fn() } }));
vi.mock('next/navigation', () => ({ usePathname: () => '/auth' }));

const { AuthProvider, useAuth } = await import('./AuthProvider');

/** PocketBase 0.22's answer to a second account on the same email. */
const emailTaken = Object.assign(new Error('Failed to create record.'), {
  status: 400,
  data: { email: { code: 'validation_invalid_email', message: 'The email is invalid or already in use.' } },
});
const dropped = Object.assign(new Error('Something went wrong.'), { status: 0, data: {} });
const wrongPassword = Object.assign(new Error('Failed to authenticate.'), { status: 400, data: {} });

type SignUp = ReturnType<typeof useAuth>['signUp'];

function mount(): { signUp: SignUp } {
  const got: { signUp: SignUp | null } = { signUp: null };
  function Grab() {
    got.signUp = useAuth().signUp;
    return null;
  }
  render(<AuthProvider initialUser={null}><Grab /></AuthProvider>);
  return { signUp: (...args) => got.signUp!(...args) };
}

beforeEach(() => {
  create.mockReset();
  authWithPassword.mockReset();
});

describe('AuthProvider sign-up', () => {
  it('a second Register after the account was made but the sign-in was lost signs in', async () => {
    const { signUp } = mount();
    create.mockResolvedValueOnce({ id: 'u1' }).mockRejectedValueOnce(emailTaken);
    authWithPassword.mockRejectedValueOnce(dropped).mockResolvedValueOnce({ token: 't', record: { id: 'u1' } });

    let first: Awaited<ReturnType<SignUp>> | null = null;
    await act(async () => {
      first = await signUp('new@x.test', 'correct horse');
    });
    expect(first!.error).not.toBeNull();

    let second: Awaited<ReturnType<SignUp>> | null = null;
    await act(async () => {
      second = await signUp('new@x.test', 'correct horse');
    });
    expect(second!.error).toBeNull();
    expect(authWithPassword).toHaveBeenLastCalledWith('new@x.test', 'correct horse');
  });

  it('an email that is taken with another password still says why the account could not be made', async () => {
    const { signUp } = mount();
    create.mockRejectedValueOnce(emailTaken);
    authWithPassword.mockRejectedValueOnce(wrongPassword);

    let result: Awaited<ReturnType<SignUp>> | null = null;
    await act(async () => {
      result = await signUp('new@x.test', 'another one');
    });
    expect(result!.error?.message).toBe('email: The email is invalid or already in use.');
  });

  it('any other refusal (a short password) is not followed by a sign-in attempt', async () => {
    const { signUp } = mount();
    create.mockRejectedValueOnce(
      Object.assign(new Error('Failed to create record.'), {
        status: 400,
        data: { password: { code: 'validation_length_out_of_range', message: 'The length must be between 8 and 72.' } },
      }),
    );

    let result: Awaited<ReturnType<SignUp>> | null = null;
    await act(async () => {
      result = await signUp('new@x.test', 'short');
    });
    expect(result!.error?.message).toBe('password: The length must be between 8 and 72.');
    expect(authWithPassword).not.toHaveBeenCalled();
  });
});
