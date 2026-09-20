import { create } from 'zustand';

/**
 * One reversible step. Both halves replay through the normal store actions, so
 * an undo persists, rolls back and resolves conflicts exactly like the edit it
 * reverses — nothing here writes to Supabase directly.
 */
export interface UndoEntry {
  /** Shown in the "Undid: ..." toast, e.g. "Move block". */
  label: string;
  undo: () => void;
  redo: () => void;
}

/** How many steps are remembered; older ones fall off the bottom. */
export const UNDO_LIMIT = 50;

interface UndoStore {
  /** Oldest first; the last entry is what `undo()` reverses. */
  past: UndoEntry[];
  /** Oldest first; the last entry is what `redo()` replays. */
  future: UndoEntry[];
  /**
   * True while an entry is replaying. Store actions call `pushUndo` freely;
   * this is what stops an undo from recording itself as a new step.
   */
  isReplaying: boolean;

  push: (entry: UndoEntry) => void;
  /** Reverses the newest step; returns it, or null when there is nothing to undo. */
  undo: () => UndoEntry | null;
  /** Replays the step the last `undo()` reversed. */
  redo: () => UndoEntry | null;
  /**
   * Undoes `entry` only if it is still the newest step — used by the "Undo"
   * button on the delete toast, which must not reverse a later edit.
   */
  undoEntry: (entry: UndoEntry | null) => UndoEntry | null;
  /** The newest step, without undoing it. */
  peek: () => UndoEntry | null;
  clear: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useUndoStore = create<UndoStore>()((set, get) => ({
  past: [],
  future: [],
  isReplaying: false,

  push: (entry) => {
    // An undo/redo is a replay of something already on the stack, never a new step.
    if (get().isReplaying) return;
    set(state => {
      const past = [...state.past, entry];
      if (past.length > UNDO_LIMIT) past.splice(0, past.length - UNDO_LIMIT);
      // Any fresh edit invalidates the redo branch.
      return { past, future: [] };
    });
  },

  undo: () => {
    const { past, isReplaying } = get();
    if (isReplaying || past.length === 0) return null;
    const entry = past[past.length - 1];
    set({ past: past.slice(0, -1), isReplaying: true });
    try {
      entry.undo();
    } finally {
      set({ isReplaying: false });
    }
    set(state => ({ future: [...state.future, entry] }));
    return entry;
  },

  redo: () => {
    const { future, isReplaying } = get();
    if (isReplaying || future.length === 0) return null;
    const entry = future[future.length - 1];
    set({ future: future.slice(0, -1), isReplaying: true });
    try {
      entry.redo();
    } finally {
      set({ isReplaying: false });
    }
    set(state => ({ past: [...state.past, entry] }));
    return entry;
  },

  undoEntry: (entry) => {
    if (!entry || get().peek() !== entry) return null;
    return get().undo();
  },

  peek: () => {
    const { past } = get();
    return past.length > 0 ? past[past.length - 1] : null;
  },

  clear: () => set({ past: [], future: [] }),

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));

/** Selectors, for components that want to re-render as the stack changes. */
export const selectCanUndo = (state: UndoStore) => state.past.length > 0;
export const selectCanRedo = (state: UndoStore) => state.future.length > 0;

/** Record a step. No-op while an undo/redo is replaying. */
export function pushUndo(entry: UndoEntry): void {
  useUndoStore.getState().push(entry);
}

/** Forget every step — the stack belongs to one board. */
export function clearUndo(): void {
  useUndoStore.getState().clear();
}
