import { describe, expect, it } from 'vitest';
import { micUnavailableMessage, MSG_IOS_UNSUPPORTED, MSG_UPDATE_APP, MSG_WEB_UNSUPPORTED, speechErrorMessage } from './messages';

describe('speechErrorMessage', () => {
  it.each([
    ['permission-denied', 'web', undefined, 'Allow microphone access to use voice search.'],
    ['permission-denied', 'tauri', undefined, 'Allow microphone access to use voice search.'],
    ['unavailable', 'web', undefined, "Voice search isn't supported in this browser: try Chrome."],
    ['unavailable', 'web', 'no-recognizer', "Voice search isn't supported in this browser: try Chrome."],
    ['unavailable', 'capacitor', 'no-bridge', 'Update the Ember app to use voice search.'],
    ['unavailable', 'tauri', 'no-bridge', 'Update the Ember app to use voice search.'],
    ['unavailable', 'capacitor', 'no-recognizer', "Voice search isn't available on this device."],
    ['unavailable', 'tauri', undefined, "Voice search isn't available on this device."],
    ['network', 'capacitor', undefined, 'Voice search needs an internet connection right now.'],
    [
      'speech-setting-off',
      'tauri',
      undefined,
      'Turn on Online speech recognition in Windows Settings (Privacy & security, Speech) to use voice search.',
    ],
    ['no-speech', 'web', undefined, null],
    ['aborted', 'tauri', undefined, null],
  ] as const)('%s in %s (%s)', (kind, shell, reason, expected) => {
    expect(speechErrorMessage(kind, shell, reason)).toBe(expected);
  });
});

describe('micUnavailableMessage', () => {
  it('points a browser at Chrome', () => {
    expect(micUnavailableMessage('web', false)).toBe(MSG_WEB_UNSUPPORTED);
  });

  it('tells an old Android or desktop app to update', () => {
    expect(micUnavailableMessage('capacitor', false)).toBe(MSG_UPDATE_APP);
    expect(micUnavailableMessage('tauri', false)).toBe(MSG_UPDATE_APP);
  });

  // Updating would not help: the iPhone app has no recognizer yet.
  it('says plainly that the iPhone app has no voice search', () => {
    expect(micUnavailableMessage('capacitor', true)).toBe(MSG_IOS_UNSUPPORTED);
  });
});
