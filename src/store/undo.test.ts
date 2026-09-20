import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUndoStore, pushUndo, clearUndo, UNDO_LIMIT, type UndoEntry } from './undo';

/** An entry that records the order in which its halves ran. */
function entry(label: string, log: string[]): UndoEntry {
  return {
    label,
    undo: () => log.push(`undo:${label}`),
    redo: () => log.push(`redo:${label}`),
  };
}

beforeEach(() => {
  useUndoStore.setState({ past: [], future: [], isReplaying: false });
});

describe('undo stack', () => {
  it('undoes and redoes the newest step', () => {
    const log: string[] = [];
    pushUndo(entry('a', log));
    pushUndo(entry('b', log));

    expect(useUndoStore.getState().canUndo()).toBe(true);
    expect(useUndoStore.getState().canRedo()).toBe(false);

    expect(useUndoStore.getState().undo()?.label).toBe('b');
    expect(useUndoStore.getState().undo()?.label).toBe('a');
    expect(useUndoStore.getState().undo()).toBeNull();
    expect(useUndoStore.getState().canUndo()).toBe(false);

    expect(useUndoStore.getState().redo()?.label).toBe('a');
    expect(useUndoStore.getState().redo()?.label).toBe('b');
    expect(useUndoStore.getState().redo()).toBeNull();

    expect(log).toEqual(['undo:b', 'undo:a', 'redo:a', 'redo:b']);
  });

  it('does not record the actions an undo replays', () => {
    const log: string[] = [];
    // A real entry's undo() calls store actions, which call pushUndo again.
    pushUndo({
      label: 'move',
      undo: () => {
        log.push('undo');
        pushUndo(entry('from-replay', log));
      },
      redo: () => log.push('redo'),
    });

    useUndoStore.getState().undo();

    expect(useUndoStore.getState().past).toHaveLength(0);
    expect(useUndoStore.getState().future).toHaveLength(1);
    expect(useUndoStore.getState().isReplaying).toBe(false);
  });

  it('drops the redo branch when a new step is pushed', () => {
    const log: string[] = [];
    pushUndo(entry('a', log));
    useUndoStore.getState().undo();
    expect(useUndoStore.getState().canRedo()).toBe(true);

    pushUndo(entry('b', log));

    expect(useUndoStore.getState().canRedo()).toBe(false);
    expect(useUndoStore.getState().redo()).toBeNull();
  });

  it('keeps at most UNDO_LIMIT steps, dropping the oldest', () => {
    const log: string[] = [];
    for (let i = 0; i < UNDO_LIMIT + 10; i++) pushUndo(entry(`step-${i}`, log));

    const { past } = useUndoStore.getState();
    expect(past).toHaveLength(UNDO_LIMIT);
    expect(past[0].label).toBe('step-10');
    expect(past[past.length - 1].label).toBe(`step-${UNDO_LIMIT + 9}`);
  });

  it('clears both stacks, e.g. when the board changes', () => {
    const log: string[] = [];
    pushUndo(entry('a', log));
    useUndoStore.getState().undo();
    pushUndo(entry('b', log));

    clearUndo();

    expect(useUndoStore.getState().canUndo()).toBe(false);
    expect(useUndoStore.getState().canRedo()).toBe(false);
  });

  it('undoEntry only reverses a step that is still the newest', () => {
    const log: string[] = [];
    const first = entry('delete', log);
    pushUndo(first);

    // Something else happened since — the toast's Undo must not reverse that.
    pushUndo(entry('later', log));
    expect(useUndoStore.getState().undoEntry(first)).toBeNull();
    expect(log).toEqual([]);

    // Back on top, it undoes.
    useUndoStore.getState().undo();
    expect(useUndoStore.getState().undoEntry(first)).toBe(first);
    expect(log).toEqual(['undo:later', 'undo:delete']);
  });

  it('ignores a null entry', () => {
    expect(useUndoStore.getState().undoEntry(null)).toBeNull();
  });

  it('leaves the stack usable when an entry throws', () => {
    const boom = vi.fn(() => {
      throw new Error('write failed');
    });
    pushUndo({ label: 'bad', undo: boom, redo: () => {} });

    expect(() => useUndoStore.getState().undo()).toThrow('write failed');
    expect(useUndoStore.getState().isReplaying).toBe(false);
    expect(useUndoStore.getState().canUndo()).toBe(false);
  });
});
