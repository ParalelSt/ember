import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { act } from 'react';
import { DesktopUpdateCard, desktopUpdateLine } from './DesktopUpdateCard';
import { INITIAL_UPDATE_STATE } from '@/stores/useUpdateStore';

/** Settings' Updates card in the desktop app. The bug: the desktop app had
 *  no update control in the page at all (only the launch dialog, which shows
 *  only when a new app is out at the moment of launch). */

const base = { ...INITIAL_UPDATE_STATE };

describe('desktopUpdateLine', () => {
  it('says where updates stand', () => {
    expect(desktopUpdateLine(base)).toBe('Ember checks for updates by itself');
    expect(desktopUpdateLine({ ...base, status: 'checking' })).toBe('Checking for updates…');
    expect(desktopUpdateLine({ ...base, status: 'up-to-date' })).toBe('Ember is up to date');
    expect(desktopUpdateLine({ ...base, status: 'failed' })).toBe("Couldn't check for updates");
  });

  it('names the new version and what happens next', () => {
    const offer = { kind: 'web' as const, version: '0.7.44', canApply: true };
    expect(desktopUpdateLine({ ...base, status: 'available', offer })).toBe('Ember 0.7.44 is ready');
    expect(desktopUpdateLine({ ...base, status: 'available', offer, pending: true })).toBe(
      'Ember 0.7.44 is ready. Updating after this song',
    );
    expect(
      desktopUpdateLine({ ...base, status: 'available', offer: { kind: 'shell', version: '0.4.27', canApply: false } }),
    ).toBe('Ember 0.4.27 is ready. Quit and reopen Ember to install it');
  });
});

describe('DesktopUpdateCard', () => {
  it('renders nothing in a browser', async () => {
    const { container } = render(<DesktopUpdateCard />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });
});
