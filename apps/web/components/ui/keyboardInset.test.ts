import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

// Regression: on Android 15 the Capacitor WebView no longer resizes for the
// keyboard, so a dialog with a text field (Settings > Help > Request a
// feature) was centred on the full screen, taller than what the keyboard left,
// with nothing scrollable. The shared dialog and sheet must cap their height
// above the keyboard and scroll, and the native shell must publish the height.
describe('keyboard inset', () => {
  const dialog = read('components/ui/dialog.tsx');
  const sheet = read('components/ui/sheet.tsx');
  const css = read('app/globals.css');

  it('publishes --keyboard-inset from the native --ember-inset-keyboard, defaulting to 0', () => {
    expect(css).toContain('--keyboard-inset: var(--ember-inset-keyboard, 0px);');
  });

  it('caps the dialog height above the keyboard and lets it scroll', () => {
    expect(dialog).toContain('max-h-[calc(100dvh-2rem-var(--keyboard-inset,0px))]');
    expect(dialog).toContain('overflow-y-auto');
    expect(dialog).toContain('top-[calc((100dvh-var(--keyboard-inset,0px))/2)]');
    expect(dialog).not.toContain('top-1/2');
    expect(dialog).not.toMatch(/\b100vh\b/);
  });

  it('scrolls a focused field into view', () => {
    expect(dialog).toContain('onFocusCapture');
    expect(dialog).toContain('scrollIntoView');
  });

  it('lifts a bottom sheet above the keyboard and caps its height', () => {
    expect(sheet).toContain('data-[side=bottom]:bottom-(--keyboard-inset)');
    expect(sheet).toContain('data-[side=bottom]:max-h-[calc(100dvh-var(--keyboard-inset,0px))]');
    expect(sheet).toContain('data-[side=bottom]:overflow-y-auto');
  });

  it('the Android shell publishes the keyboard height under that same name', () => {
    const kt = readFileSync(
      join(__dirname, '../../../mobile/android/app/src/main/java/app/ember/music/SafeAreaInsets.kt'),
      'utf8',
    );
    expect(kt).toContain('"--ember-inset-keyboard"');
    expect(kt).toContain('WindowInsetsCompat.Type.ime()');
  });
});
