import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The desktop shell's launch gate page (apps/desktop/src-tauri/offline/
// gate.html), driven the way the shell drives it: `gate:state` events and
// the gate_* commands, through a mocked window.__TAURI__. The page owns no
// decisions (src/gate.rs does); this checks it shows every state with the
// owner's copy and passes every button on.

const PAGE = readFileSync(join(__dirname, '../../desktop/src-tauri/offline/gate.html'), 'utf8');

type View = Record<string, unknown>;

let invoked: string[];
let emit: (v: View | null) => void;
let initial: View | null;
/** Listeners each load of the page put on the shared document, taken off
 *  again so one test's page does not answer another's keys. */
const added: Array<[string, EventListenerOrEventListenerObject]> = [];

function load() {
  const doc = new DOMParser().parseFromString(PAGE, 'text/html');
  document.head.innerHTML = doc.head.innerHTML;
  document.body.innerHTML = doc.body.innerHTML;
  const script = doc.querySelector('script')!.textContent!;
  (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string) => {
        invoked.push(cmd);
        return Promise.resolve(cmd === 'gate_state' ? initial : null);
      },
    },
    event: {
      listen: (name: string, cb: (e: { payload: View | null }) => void) => {
        expect(name).toBe('gate:state');
        emit = (v) => cb({ payload: v });
        return Promise.resolve(() => {});
      },
    },
  };
  const add = document.addEventListener.bind(document);
  document.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
    added.push([type, fn]);
    add(type, fn, opts);
  }) as typeof document.addEventListener;
  try {
    new Function(script)();
  } finally {
    delete (document as unknown as { addEventListener?: unknown }).addEventListener;
  }
}

function unload() {
  for (const [type, fn] of added.splice(0)) document.removeEventListener(type, fn);
}

const $ = (id: string) => document.getElementById(id)!;
const text = (id: string) => $(id).textContent;
const visible = (id: string) => !($(id) as HTMLElement).hidden;

function view(phase: string, extra: View = {}): View {
  return { phase, version: '0.4.23', mandatory: false, reason: null, recovery: false, updateNow: false, asksPassword: false, background: null, ...extra };
}

beforeEach(() => {
  invoked = [];
  initial = null;
  load();
});

afterEach(() => {
  unload();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe('desktop launch gate page', () => {
  it('starts as the splash, with no dialog, and asks for the state so far', () => {
    expect(visible('scrim')).toBe(false);
    expect(invoked).toContain('gate_state');
    emit(view('checking'));
    expect(visible('scrim')).toBe(false);
  });

  it('paints the theme colour it is given, and ignores anything that is not one', () => {
    emit(view('checking', { background: '#102030' }));
    expect(document.body.style.background).toMatch(/#102030|rgb\(16, 32, 48\)/);
    emit(view('checking', { background: 'url(evil)' }));
    expect(document.body.style.background).not.toContain('evil');
  });

  it('downloading: "Updating Ember", the version and percent, Not now and Update now', () => {
    emit(view('downloading', { percent: null }));
    expect(visible('scrim')).toBe(true);
    expect(text('title')).toBe('Updating Ember');
    expect(text('detail')).toBe('Version 0.4.23');
    expect($('bar').className).toContain('indeterminate');
    emit(view('downloading', { percent: 42 }));
    expect(text('detail')).toBe('Version 0.4.23 · 42%');
    expect(($('fill') as HTMLElement).style.width).toBe('42%');
    expect(text('cancel')).toBe('Not now');
    expect(text('primary')).toBe('Update now');
    expect(document.activeElement).toBe($('cancel'));
  });

  it('countdown: "Restarting in 7s" as plain text, counting down', () => {
    emit(view('countdown', { seconds: 7, held: false }));
    expect(text('title')).toBe('Restarting in 7s');
    expect(text('detail')).toBe('Version 0.4.23 is ready');
    expect(visible('bar')).toBe(false);
    emit(view('countdown', { seconds: 3, held: false }));
    expect(text('title')).toBe('Restarting in 3s');
  });

  it('the two buttons pass on Not now and Update now', () => {
    emit(view('countdown', { seconds: 7, held: false }));
    ($('cancel') as HTMLButtonElement).click();
    ($('primary') as HTMLButtonElement).click();
    expect(invoked).toEqual(expect.arrayContaining(['gate_not_now', 'gate_update_now']));
  });

  it('Update now during the download shows it took', () => {
    emit(view('downloading', { percent: 10, updateNow: true }));
    expect(text('primary')).toBe('Updating...');
    expect(($('primary') as HTMLButtonElement).disabled).toBe(true);
    invoked = [];
    ($('primary') as HTMLButtonElement).click();
    expect(invoked).not.toContain('gate_update_now');
  });

  it('a required update: one-line reason, and Quit Ember in place of Not now', () => {
    emit(view('downloading', { mandatory: true, reason: 'min-version', percent: 5 }));
    expect(text('title')).toBe('Ember needs an update');
    expect(visible('reason')).toBe(true);
    expect(text('reason')).toBe('This version no longer works with the server.');
    expect(text('cancel')).toBe('Quit Ember');
    ($('cancel') as HTMLButtonElement).click();
    expect(invoked).toContain('gate_quit');
    expect(invoked).not.toContain('gate_not_now');
    emit(view('countdown', { mandatory: true, reason: 'flagged', seconds: 7, held: true }));
    expect(text('reason')).toBe('This update fixes a serious problem.');
    expect(text('detail')).toBe('Waiting until Ember is in front again');
  });

  it('Esc is Not now, but never quits a required update', () => {
    emit(view('countdown', { seconds: 7, held: false }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(invoked).toContain('gate_not_now');
    invoked = [];
    emit(view('countdown', { mandatory: true, reason: 'flagged', seconds: 7, held: false }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(invoked).toEqual([]);
  });

  it('Enter away from the buttons is Update now', () => {
    emit(view('countdown', { seconds: 7, held: false }));
    ($('cancel') as HTMLButtonElement).blur();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(invoked).toContain('gate_update_now');
  });

  it('recovery: "Getting a fix" and why, with Not now kept', () => {
    emit(view('downloading', { recovery: true }));
    expect(text('title')).toBe('Getting a fix');
    expect(text('reason')).toBe("Ember didn't start properly last time.");
    expect(text('cancel')).toBe('Not now');
  });

  it('installing: no buttons, and a password note for a .deb or .rpm', () => {
    emit(view('installing'));
    expect(text('title')).toBe('Installing update');
    expect(text('detail')).toBe('Ember reopens in a moment');
    expect(visible('buttons')).toBe(false);
    emit(view('installing', { asksPassword: true }));
    expect(text('detail')).toBe('Enter your password to install it');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(invoked).not.toContain('gate_not_now');
  });

  it('manual: the download page notice', () => {
    emit(view('manual', { url: 'https://ember.test/api/desktop/asset/5' }));
    expect(text('title')).toBe('Ember 0.4.23 is out');
    expect(text('detail')).toBe('Update it from the download page');
    expect(text('primary')).toBe('Open download page');
    ($('primary') as HTMLButtonElement).click();
    expect(invoked).toContain('gate_update_now');
  });

  it('failed: says so, no buttons (the app opens by itself)', () => {
    emit(view('failed'));
    expect(text('title')).toBe("Couldn't update");
    expect(text('detail')).toBe("Opening Ember. We'll try again next time.");
    expect(visible('buttons')).toBe(false);
  });

  it('done: the dialog goes away', () => {
    emit(view('countdown', { seconds: 7, held: false }));
    emit(view('done'));
    expect(visible('scrim')).toBe(false);
  });

  it('shows the state it asks for when it loaded after the first event', async () => {
    initial = view('countdown', { seconds: 5, held: false });
    unload();
    load();
    await vi.waitFor(() => expect(text('title')).toBe('Restarting in 5s'));
  });

  it('works with the bare IPC bridge too, and never throws without one', () => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    const doc = new DOMParser().parseFromString(PAGE, 'text/html');
    document.body.innerHTML = doc.body.innerHTML;
    expect(() => new Function(doc.querySelector('script')!.textContent!)()).not.toThrow();
  });
});
