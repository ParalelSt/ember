'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useThemeStore, type ThemeDraft } from '@/stores/useThemeStore';
import { applyChange, isMoreKey, pinnedOf, refill, selectionOf, uniqueName, type MoreKey, type Selection } from '@/lib/theme/editor';
import { problems, type Finding } from '@/lib/theme/guard';
import { cleanThemeName, INPUT_KEYS, sameInputs, THEME_NAME_MAX, type PresetId, type ThemeInputKey, type ThemeInputs } from '@/lib/theme/model';
import type { Oklch } from '@/lib/theme/oklch';
import { PRESET_BY_ID } from '@/lib/theme/presets';
import { docFromPreset, docFromSaved, THEME_CAP, type SavedTheme, type ThemesList } from '@/lib/theme/saved';

export type SaveTone = 'idle' | 'saving' | 'saved' | 'blocked' | 'error';
export interface SaveStatus {
  tone: SaveTone;
  text: string;
}

const IDLE: SaveStatus = { tone: 'idle', text: '' };
const APPLYING: SaveStatus = { tone: 'saving', text: 'Applying' };
const APPLIED: SaveStatus = { tone: 'saved', text: 'Applied' };
const SAVED: SaveStatus = { tone: 'saved', text: 'Saved' };

type ApiError = Error & { status?: number; body?: { error?: string; findings?: { label: string }[] } };

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const unreadableLine = (label: string) => `Not saved: ${lowerFirst(label)} is hard to read.`;

/** What a failed call means, in plain words. */
function refusal(e: unknown): string {
  const err = (e ?? {}) as ApiError;
  if (err.status === 409) return err.body?.error ?? `You can keep up to ${THEME_CAP} themes. Delete one to make room.`;
  if (err.status === 422) {
    const label = err.body?.findings?.[0]?.label;
    return label ? `${lowerFirst(label)} is hard to read.` : 'some colours are hard to read.';
  }
  if (err.status === 404) return 'that theme is gone.';
  return 'check your connection and try again.';
}

/** Settings > Appearance: the active theme from the store, the saved and
 *  shared lists from /api/themes, and the draft (the store's `draft`): the
 *  theme picked and the colours changed, shown only in the page's preview
 *  pane. Nothing reaches the app or the account until `apply`:
 *  - a preset or a saved theme picked as it is becomes the active one;
 *  - edits to one of mine save its colours, then it becomes the active one;
 *  - edits to a preset (or a kept copy) save a new theme of mine, "My
 *    Midnight", which becomes the active one.
 *  A draft with an unreadable pair cannot be applied and is never changed
 *  silently. Leaving the page applies nothing; the draft stays in the store
 *  for the session, so coming back shows it again with Apply. */
export function useThemeEditor() {
  const doc = useThemeStore((s) => s.doc);
  const draft = useThemeStore((s) => s.draft);
  const [list, setListState] = useState<ThemesList | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState<SaveStatus>(IDLE);
  const [notice, setNotice] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [applying, setApplying] = useState(false);

  // The async paths read these, not render-time values: an apply that
  // finishes after more edits must see the newest list.
  const listRef = useRef<ThemesList | null>(null);
  // Every call that writes the active theme (apply, delete) runs through
  // this queue, one after another: an apply that saves colours and then
  // switches must land before a later one switches again, or the late save
  // could put back the theme the person just moved off (bughunt N2; the
  // server half is the per-account lock in lib/theme/serverActive.ts).
  const queue = useRef<Promise<void>>(Promise.resolve());

  const setList = useCallback((next: ThemesList | null) => {
    listRef.current = next;
    setListState(next);
  }, []);
  const editList = useCallback(
    (fn: (l: ThemesList) => ThemesList) => {
      if (listRef.current) setList(fn(listRef.current));
    },
    [setList],
  );
  const putMine = useCallback(
    (theme: SavedTheme) =>
      editList((l) => ({
        ...l,
        mine: l.mine.some((t) => t.id === theme.id) ? l.mine.map((t) => (t.id === theme.id ? theme : t)) : [theme, ...l.mine],
      })),
    [editList],
  );

  /** Store a draft, or none when it would show exactly the active theme. */
  const putDraft = useCallback((next: ThemeDraft | null) => {
    const store = useThemeStore.getState();
    if (next) {
      const l = listRef.current;
      const sel = selectionOf(next.target, l);
      const edited = next.edit !== null && next.edit.key === sel.key && !sameInputs(next.edit.inputs, sel.inputs);
      if (!edited && sel.key === selectionOf(store.doc, l).key) next = null;
    }
    store.setDraft(next);
  }, []);

  useEffect(() => {
    let live = true;
    api
      .listThemes()
      .then((l) => live && setList(l))
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, [setList]);

  /** The active theme, and what the page shows: the draft's pick, else the
   *  active theme. */
  const active = selectionOf(doc, list);
  const selection = selectionOf(draft?.target ?? doc, list);
  const current = draft?.edit && draft.edit.key === selection.key ? draft.edit : null;
  const inputs = current?.inputs ?? selection.inputs;
  const pinned: ReadonlySet<MoreKey> = current?.pinned ?? pinnedOf(selection.inputs);
  const edited = current !== null && !sameInputs(current.inputs, selection.inputs);
  /** The draft differs from the active theme: Apply and Back to current show. */
  const dirty = edited || selection.key !== active.key;
  const editable = selection.kind === 'mine' || selection.kind === 'preset' || selection.kind === 'loose';

  const findings = problems(inputs);
  const failing = dirty ? findings.find((f) => f.level === 'fail') : undefined;
  const canApply =
    dirty && !failing && selection.kind !== 'pending' && (list !== null || (selection.kind === 'preset' && !edited));

  const edit = (next: { inputs: ThemeInputs; pinned: ReadonlySet<MoreKey> }) => {
    if (!editable) return;
    const store = useThemeStore.getState();
    putDraft({ target: store.draft?.target ?? store.doc, edit: { key: selection.key, ...next } });
    setStatus(IDLE);
  };

  const change = (key: ThemeInputKey, value: Oklch) => edit(applyChange(inputs, pinned, key, value));

  const unpin = (key: MoreKey) => {
    const next = new Set(pinned);
    next.delete(key);
    edit({ inputs: refill(inputs, next), pinned: next });
  };

  const fix = (finding: Finding) => {
    if (!finding.fix) return;
    const moved = INPUT_KEYS.find((k) => !sameInputs({ ...inputs, [k]: finding.fix![k] }, inputs));
    const next = new Set(pinned);
    if (moved && isMoreKey(moved)) next.add(moved);
    edit({ inputs: finding.fix, pinned: next });
  };

  const reset = () => {
    const base = PRESET_BY_ID[selection.base].inputs;
    edit({ inputs: base, pinned: pinnedOf(base) });
  };

  /** Show a preset in the preview. Nothing is applied or saved. */
  const pickPreset = (preset: PresetId) => {
    setNotice(null);
    setStatus(IDLE);
    putDraft({ target: docFromPreset(preset), edit: null });
  };

  /** Show a saved theme (mine or shared) in the preview. */
  const use = (id: string) => {
    const l = listRef.current;
    const row = l?.mine.find((t) => t.id === id) ?? l?.shared.find((t) => t.id === id);
    if (!row) return;
    setNotice(null);
    setStatus(IDLE);
    putDraft({ target: docFromSaved(row), edit: null });
  };

  /** Back to current: drop the draft, the preview shows the active theme. */
  const discard = () => {
    setNotice(null);
    setStatus(IDLE);
    putDraft(null);
  };

  /** Runs one apply: save what needs saving, then make it the active theme.
   *  `sel` and `edits` are what the page showed when Apply was pressed. */
  const runApply = useCallback(
    async (sel: Selection, edits: ThemeInputs | null, snapshot: ThemeDraft | null) => {
      const store = () => useThemeStore.getState();
      let made: SavedTheme | null = null;
      let ok = true;
      try {
        if (edits && sel.kind === 'mine') {
          const res = await api.updateSavedTheme(sel.key, { inputs: edits });
          putMine(res.theme);
          // In use already: the server moved the active copy along with it.
          if (res.active) store().adopt(res.active);
          else ok = (await store().select({ themeId: res.theme.id }, docFromSaved(res.theme))) !== null;
        } else if (edits && (sel.kind === 'preset' || sel.kind === 'loose')) {
          const taken = listRef.current?.mine.map((t) => t.name) ?? [];
          const name = uniqueName(sel.kind === 'preset' ? `My ${sel.name}` : sel.name, taken);
          made = (await api.createTheme({ name, base: sel.base, inputs: edits })).theme;
          putMine(made);
          ok = (await store().select({ themeId: made.id }, docFromSaved(made))) !== null;
        } else if (sel.kind === 'preset') {
          ok = (await store().select({ preset: sel.base })) !== null;
        } else if (sel.kind === 'mine' || sel.kind === 'others') {
          ok = (await store().select({ themeId: sel.key }, docFromSaved(sel.theme))) !== null;
          if (!ok) api.listThemes().then(setList, () => {});
        }
      } catch (e) {
        setStatus({ tone: 'error', text: `Not applied: ${refusal(e)}` });
        return;
      }
      if (!ok) {
        setStatus({
          tone: 'error',
          text: made ? `Saved as ${made.name}, but could not switch to it.` : `Not applied: ${refusal(null)}`,
        });
        return;
      }
      // Done with the draft, unless it changed while this was in flight:
      // then it stays, and an edit made to a preset follows it into the new
      // theme it was just saved as.
      const now = store().draft;
      if (now === snapshot) putDraft(null);
      else if (made && now?.edit?.key === sel.key) putDraft({ target: docFromSaved(made), edit: { ...now.edit, key: made.id } });
      else putDraft(now);
      setStatus(made ? { tone: 'saved', text: `Applied. Saved as ${made.name}.` } : APPLIED);
    },
    [putDraft, putMine, setList],
  );

  /** Make the draft the active theme, site-wide and on the account. */
  const apply = (): Promise<void> => {
    if (!canApply) return queue.current;
    const snapshot = useThemeStore.getState().draft;
    const sel = selection;
    const edits = edited ? inputs : null;
    setNotice(null);
    setStatus(APPLYING);
    setApplying(true);
    const run = queue.current.then(() => runApply(sel, edits, snapshot)).catch(() => {});
    queue.current = run;
    run.then(() => {
      if (queue.current === run) setApplying(false);
    });
    return run;
  };

  /** New: a copy of what is showing, saved to my list and shown in the
   *  preview, ready to edit or apply. */
  const create = async (): Promise<boolean> => {
    const l = listRef.current;
    if (!l) return false;
    setNotice(null);
    try {
      const { theme } = await api.createTheme({
        name: uniqueName('New theme', l.mine.map((t) => t.name)),
        base: selection.base,
        inputs,
      });
      putMine(theme);
      putDraft({ target: docFromSaved(theme), edit: null });
      setStatus({ tone: 'saved', text: `Saved as ${theme.name}` });
      return true;
    } catch (e) {
      setNotice(`Not made: ${refusal(e)}`);
      return false;
    }
  };

  const rename = async (id: string, raw: string): Promise<string | null> => {
    const name = cleanThemeName(raw);
    if (!name) return `A name is 1 to ${THEME_NAME_MAX} characters.`;
    try {
      const res = await api.updateSavedTheme(id, { name });
      putMine(res.theme);
      if (res.active) useThemeStore.getState().adopt(res.active);
      return null;
    } catch (e) {
      return `Not renamed: ${refusal(e)}`;
    }
  };

  const copy = async (id: string, verb: 'Duplicated' | 'Copied to My themes') => {
    setNotice(null);
    try {
      const { theme } = await api.duplicateTheme(id);
      putMine(theme);
      setNotice(`${verb} as ${theme.name}.`);
    } catch (e) {
      setNotice(`Not copied: ${refusal(e)}`);
    }
  };

  /** Delete one of mine. Queued behind any apply still running, which may
   *  be switching to it; deleting the one in use goes back to its base
   *  preset (the server's `active`, bughunt V10). */
  const remove = (id: string): Promise<void> => {
    setNotice(null);
    const run = queue.current.then(async () => {
      try {
        const res = await api.deleteSavedTheme(id);
        editList((l) => ({ ...l, mine: l.mine.filter((t) => t.id !== id) }));
        if (res.active) useThemeStore.getState().adopt(res.active);
        const d = useThemeStore.getState().draft;
        putDraft(d?.target.themeId === id ? null : d);
      } catch (e) {
        setNotice(`Not deleted: ${refusal(e)}`);
      }
    });
    queue.current = run;
    return run;
  };

  const setShared = async (shared: boolean) => {
    if (selection.kind !== 'mine') return;
    setSharing(true);
    try {
      const res = await api.updateSavedTheme(selection.key, { shared });
      putMine(res.theme);
      setStatus(SAVED);
    } catch (e) {
      setStatus({ tone: 'error', text: `Not saved: ${refusal(e)}` });
    } finally {
      setSharing(false);
    }
  };

  const shownStatus: SaveStatus = failing ? { tone: 'blocked', text: unreadableLine(failing.label) } : status;

  return {
    /** What the page shows (the draft's pick, else the active theme). */
    selection,
    /** The active theme. */
    active,
    list,
    loadFailed,
    inputs,
    pinned,
    findings,
    dirty,
    edited,
    canApply,
    applying,
    editable,
    status: shownStatus,
    notice,
    sharing,
    change,
    unpin,
    fix,
    reset,
    pickPreset,
    use,
    apply,
    discard,
    create,
    rename,
    duplicate: (id: string) => copy(id, 'Duplicated'),
    copyShared: (id: string) => copy(id, 'Copied to My themes'),
    remove,
    setShared,
  };
}
