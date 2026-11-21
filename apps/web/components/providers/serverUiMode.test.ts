// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = vi.hoisted(() => ({ value: undefined as string | undefined, throws: null as unknown }));
vi.mock('next/headers', () => ({
  cookies: async () => {
    if (jar.throws) throw jar.throws;
    return { get: (name: string) => (name === 'ember_ui' && jar.value !== undefined ? { value: jar.value } : undefined) };
  },
}));

const { serverUiMode } = await import('./serverUiMode');

beforeEach(() => {
  jar.value = undefined;
  jar.throws = null;
  delete process.env.EMBER_DEFAULT_UI;
});

describe('serverUiMode', () => {
  it('reads the device cookie', async () => {
    jar.value = 'legacy';
    expect(await serverUiMode()).toBe('legacy');
    jar.value = 'new';
    expect(await serverUiMode()).toBe('new');
  });

  it('no cookie: EMBER_DEFAULT_UI at request time, else the new look', async () => {
    expect(await serverUiMode()).toBe('new');
    process.env.EMBER_DEFAULT_UI = 'legacy';
    expect(await serverUiMode()).toBe('legacy');
    jar.value = 'new';
    expect(await serverUiMode()).toBe('new');
  });

  it('outside a request: the default', async () => {
    jar.throws = new Error('cookies was called outside a request scope');
    expect(await serverUiMode()).toBe('new');
  });

  it('hands Next its own signals back (a dynamic render, a postpone)', async () => {
    jar.throws = Object.assign(new Error('Dynamic server usage'), { digest: 'DYNAMIC_SERVER_USAGE' });
    await expect(serverUiMode()).rejects.toBe(jar.throws);
    jar.throws = { $$typeof: Symbol.for('react.postpone') };
    await expect(serverUiMode()).rejects.toBe(jar.throws);
  });
});
