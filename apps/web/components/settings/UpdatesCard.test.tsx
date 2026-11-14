import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { act } from 'react';
import { UpdatesCard, updatesLine } from './UpdatesCard';
import { INITIAL_UPDATE_STATE } from '@/stores/useUpdateStore';

/** Settings' Updates card in the desktop and Android apps. The bug: the desktop app had
 *  no update control in the page at all (only the launch dialog, which shows
 *  only when a new app is out at the moment of launch). */

const base = { ...INITIAL_UPDATE_STATE };

describe('updatesLine', () => {
  it('says where updates stand', () => {
    expect(updatesLine(base)).toBe('Ember checks for updates by itself');
    expect(updatesLine({ ...base, status: 'checking' })).toBe('Checking for updates…');
    expect(updatesLine({ ...base, status: 'up-to-date' })).toBe('Ember is up to date');
    expect(updatesLine({ ...base, status: 'failed' })).toBe("Couldn't check for updates");
  });

  it('names the new version and what happens next', () => {
    const offer = { kind: 'web' as const, version: '0.7.44', canApply: true, via: 'reload' as const };
    expect(updatesLine({ ...base, status: 'available', offer })).toBe('Ember 0.7.44 is ready');
    expect(updatesLine({ ...base, status: 'available', offer, pending: true })).toBe(
      'Ember 0.7.44 is ready. Updating after this song',
    );
    expect(
      updatesLine({ ...base, status: 'available', offer: { kind: 'shell', version: '0.4.27', canApply: false, via: 'desktop' } }),
    ).toBe('Ember 0.4.27 is ready. Quit and reopen Ember to install it');
    expect(
      updatesLine({ ...base, status: 'available', applyFailed: true, offer: { kind: 'shell', version: '0.4.34', canApply: true, via: 'android' } }),
    ).toBe("Ember 0.4.34 is ready. Couldn't update, try again");
  });
});

describe('UpdatesCard', () => {
  it('renders nothing in a browser', async () => {
    const { container } = render(<UpdatesCard />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });
});
