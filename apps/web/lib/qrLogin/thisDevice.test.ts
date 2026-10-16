import { afterEach, describe, expect, it, vi } from 'vitest';
import { rememberedQrSignIn, rememberQrSignIn } from './thisDevice';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('this device QR sign-in', () => {
  it('remembers the request id this browser signed in with', () => {
    expect(rememberedQrSignIn()).toBeNull();
    rememberQrSignIn('req000000000001');
    expect(rememberedQrSignIn()).toBe('req000000000001');
  });

  it('ignores anything that is not a record id, stored or given', () => {
    rememberQrSignIn('<script>');
    expect(rememberedQrSignIn()).toBeNull();
    localStorage.setItem('ember-qr-signin', 'not an id');
    expect(rememberedQrSignIn()).toBeNull();
  });

  it('never throws without storage', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked });
    expect(() => rememberQrSignIn('req000000000001')).not.toThrow();
    expect(rememberedQrSignIn()).toBeNull();
  });
});
