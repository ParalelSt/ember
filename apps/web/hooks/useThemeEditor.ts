'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useThemeStore } from '@/stores/useThemeStore';
import { applyChange, isMoreKey, pinnedOf, refill, selectionOf, uniqueName, type MoreKey, type Selection } from '@/lib/theme/editor';
import { problems, type Finding } from '@/lib/theme/guard';
import { cleanThemeName, INPUT_KEYS, sameInputs, THEME_NAME_MAX, type PresetId, type ThemeDoc, type ThemeInputKey, type ThemeInputs } from '@/lib/theme/model';
import type { Oklch } from '@/lib/theme/oklch';
import { PRESET_BY_ID } from '@/lib/theme/presets';
import { docFromSaved, THEME_CAP, type SavedTheme, type ThemesList } from '@/lib/theme/saved';

/** How long colour edits wait before saving: a picker fires on every drag
 *  step. Picks, Fix it and Reset save at once. */
export const SAVE_DELAY_MS = 600;

export type SaveTone = 'idle' | 'saving' | 'saved' | 'blocked' | 'error';
export interface SaveStatus {
  tone: SaveTone;
  text: string;
}

const IDLE: SaveStatus = { tone: 'idle', text: '' };
const SAVING: SaveStatus = { tone: 'saving', text: 'Saving' };
const SAVED: SaveStatus = { tone: 'saved', text: 'Saved' };

/** The edit in progress, tied to the selection it was made on. */
interface Draft {
  key: string;
  inputs: ThemeInputs;
  pinned: Set<MoreKey>;
}

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
 *  shared lists from /api/themes, and a draft of the colours being edited.
 *  The draft shows live on the whole app (the store's preview) and saves
 *  after a short pause: to my theme when one of mine is in use, or as a new
 *  theme of mine when a preset or a kept copy is. A draft with an
 *  unreadable pair is shown but never saved, and never changed silently. */
export function useThemeEditor() {
  const doc = useThemeStore((s) => s.doc);
  const [list, setListState] = useState<ThemesList | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraftState] = useState<Draft | null>(null);
  const [status, setStatus] = useState<SaveStatus>(IDLE);
  const [notice, setNotice] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  // The async save path reads these, not render-time values: a save that
  // finishes after more edits must see the newest list and draft.
  const listRef = useRef<ThemesList | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const setList = useCallback((next: ThemesList | null) => {
    listRef.current = next;
    setListState(next);
  }, []);
  const setDraft = useCallback((next: Draft | null) => {
    draftRef.current = next;
    setDraftState(next);
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

  const selection = selectionOf(doc, list);
  const current = draft && draft.key === selection.key ? draft : null;
  const inputs = current?.inputs ?? selection.inputs;
  const pinned = current?.pinned ?? pinnedOf(selection.inputs);
  const dirty = current !== null && !sameInputs(current.inputs, selection.inputs);
  const editable = selection.kind === 'mine' || selection.kind === 'preset' || selection.kind === 'loose';

  // The draft on the whole app while it differs from what is saved;
  // leaving the page drops it.
  const previewDoc: ThemeDoc | null = dirty
    ? {
        v: 1,
        preset: selection.base,
        custom: inputs,
        name: selection.name,
        ...(selection.kind === 'mine' ? { themeId: selection.key } : {}),
      }
    : null;
  const previewKey = previewDoc ? JSON.stringify(previewDoc) : '';
  useEffect(() => {
    useThemeStore.getState().setPreview(previewKey ? (JSON.parse(previewKey) as ThemeDoc) : null);
  }, [previewKey]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      useThemeStore.getState().setPreview(null);
    },
    [],
  );

  const save = useCallback(
    async (d: Draft | null) => {
      if (!d) return;
      const isCurrent = () => selectionOf(useThemeStore.getState().doc, listRef.current).key === d.key;
      const report = (next: SaveStatus) => {
        if (isCurrent()) setStatus(next);
      };
      const mine = listRef.current?.mine.find((t) => t.id === d.key);
      const sel: Selection = selectionOf(useThemeStore.getState().doc, listRef.current);
      // A preset or a kept copy only turns into a new theme while it is
      // still the one showing; an edit to one of mine is saved even when
      // the person has just switched away (see flush).
      if (!mine && (sel.key !== d.key || (sel.kind !== 'preset' && sel.kind !== 'loose'))) return;
      if (sameInputs(d.inputs, mine?.inputs ?? sel.inputs)) {
        if (mine) report(SAVED);
        return;
      }
      const fail = problems(d.inputs).find((f) => f.level === 'fail');
      if (fail) {
        report({ tone: 'blocked', text: unreadableLine(fail.label) });
        return;
      }
      report(SAVING);
      if (mine) {
        try {
          const res = await api.updateSavedTheme(mine.id, { inputs: d.inputs });
          putMine(res.theme);
          if (res.active && useThemeStore.getState().doc.themeId === mine.id) useThemeStore.getState().adopt(res.active);
          report(SAVED);
        } catch (e) {
          report({ tone: 'error', text: `Not saved: ${refusal(e)}` });
        }
        return;
      }
      const taken = listRef.current?.mine.map((t) => t.name) ?? [];
      const name = uniqueName(sel.kind === 'preset' ? `My ${sel.name}` : sel.name, taken);
      try {
        const { theme } = await api.createTheme({ name, base: sel.base, inputs: d.inputs });
        putMine(theme);
        if (!isCurrent()) return;
        // Carry the draft (and anything changed while this was in flight)
        // over to the new theme, in the same render as the selection moves.
        const pending = useThemeStore.getState().select({ themeId: theme.id }, docFromSaved(theme));
        if (draftRef.current?.key === d.key) setDraft({ ...draftRef.current, key: theme.id });
        const ok = await pending;
        setStatus(
          ok
            ? { tone: 'saved', text: `Saved as ${theme.name}` }
            : { tone: 'error', text: `Saved as ${theme.name}, but could not switch to it.` },
        );
      } catch (e) {
        report({ tone: 'error', text: `Not saved: ${refusal(e)}` });
      }
    },
    [putMine, setDraft],
  );

  const runSave = useCallback(() => {
    const d = draftRef.current;
    queue.current = queue.current.then(() => save(d)).catch(() => {});
    return queue.current;
  }, [save]);

  const schedule = useCallback(
    (delay: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void runSave();
      }, delay);
    },
    [runSave],
  );

  /** A save that is waiting goes now: used before switching themes, so an
   *  edit to one of mine is not lost to the switch. */
  const flush = useCallback(() => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    void runSave();
  }, [runSave]);

  // Leaving Appearance (navigating away, closing the tab) must not drop a
  // colour edit still waiting out SAVE_DELAY_MS: flush it on unmount and on
  // pagehide, which fires for both cases (bughunt N1).
  useEffect(() => {
    const onPageHide = () => {
      flush();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      flush();
    };
  }, [flush]);

  const edit = useCallback(
    (next: { inputs: ThemeInputs; pinned: Set<MoreKey> }, delay: number) => {
      if (!editable) return;
      setDraft({ key: selection.key, ...next });
      setStatus(IDLE);
      schedule(delay);
    },
    [editable, schedule, selection.key, setDraft],
  );

  const change = (key: ThemeInputKey, value: Oklch) => edit(applyChange(inputs, pinned, key, value), SAVE_DELAY_MS);

  const unpin = (key: MoreKey) => {
    const next = new Set(pinned);
    next.delete(key);
    edit({ inputs: refill(inputs, next), pinned: next }, SAVE_DELAY_MS);
  };

  const fix = (finding: Finding) => {
    if (!finding.fix) return;
    const moved = INPUT_KEYS.find((k) => !sameInputs({ ...inputs, [k]: finding.fix![k] }, inputs));
    const next = new Set(pinned);
    if (moved && isMoreKey(moved)) next.add(moved);
    edit({ inputs: finding.fix, pinned: next }, 0);
  };

  const reset = () => {
    const base = PRESET_BY_ID[selection.base].inputs;
    edit({ inputs: base, pinned: pinnedOf(base) }, 0);
  };

  const leave = () => {
    flush();
    setDraft(null);
    setNotice(null);
    setStatus(IDLE);
  };

  const pickPreset = async (preset: PresetId) => {
    leave();
    const saved = await useThemeStore.getState().select({ preset });
    setStatus(saved ? SAVED : { tone: 'error', text: `Not saved: ${refusal(null)}` });
  };

  const use = async (id: string) => {
    const l = listRef.current;
    const row = l?.mine.find((t) => t.id === id) ?? l?.shared.find((t) => t.id === id);
    if (!row) return;
    leave();
    const saved = await useThemeStore.getState().select({ themeId: id }, docFromSaved(row));
    if (saved) setStatus(SAVED);
    else {
      setStatus({ tone: 'error', text: `Not saved: ${refusal(null)}` });
      api.listThemes().then(setList, () => {});
    }
  };

  /** New: a copy of what is showing, saved to my list and put in use. */
  const create = async (): Promise<boolean> => {
    const l = listRef.current;
    if (!l) return false;
    const from = inputs;
    const base = selection.base;
    leave();
    try {
      const { theme } = await api.createTheme({ name: uniqueName('New theme', l.mine.map((t) => t.name)), base, inputs: from });
      putMine(theme);
      await useThemeStore.getState().select({ themeId: theme.id }, docFromSaved(theme));
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

  const remove = async (id: string) => {
    setNotice(null);
    if (selection.key === id) flush();
    try {
      const res = await api.deleteSavedTheme(id);
      editList((l) => ({ ...l, mine: l.mine.filter((t) => t.id !== id) }));
      if (res.active) useThemeStore.getState().adopt(res.active);
    } catch (e) {
      setNotice(`Not deleted: ${refusal(e)}`);
    }
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

  const findings = problems(inputs);
  const failing = dirty ? findings.find((f) => f.level === 'fail') : undefined;
  const shownStatus: SaveStatus = failing ? { tone: 'blocked', text: unreadableLine(failing.label) } : status;

  return {
    selection,
    list,
    loadFailed,
    inputs,
    pinned,
    findings,
    dirty,
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
    create,
    rename,
    duplicate: (id: string) => copy(id, 'Duplicated'),
    copyShared: (id: string) => copy(id, 'Copied to My themes'),
    remove,
    setShared,
  };
}
