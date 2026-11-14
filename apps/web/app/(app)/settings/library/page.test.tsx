import { expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() => vi.fn(() => { throw new Error('NEXT_REDIRECT'); }));
vi.mock('next/navigation', () => ({ redirect }));
const { default: SettingsLibrary } = await import('./page');

it('/settings/library (gone from the phone list) opens Profile, where Blocked songs now are', () => {
  expect(() => SettingsLibrary()).toThrow('NEXT_REDIRECT');
  expect(redirect).toHaveBeenCalledWith('/settings/profile');
});
