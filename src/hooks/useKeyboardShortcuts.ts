import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useUndoStore } from '../store/undo';
import { nudgeBlock, flushNudge } from '../store/nudge';
import { addDaysToISO, daysBetween } from '../lib/dates';

/**
 * Every keyboard shortcut lives here, on one window listener, so the order in
 * which they are checked is visible in one place. Nothing is bound to a
 * component: the selected block (`selectedBlockId`) is what they act on.
 */

/** Typing in a field is never a shortcut. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** Undo one step and say what was undone. */
export function undoWithToast(): void {
  const entry = useUndoStore.getState().undo();
  if (entry) useAppStore.getState().addToast(`Undid: ${entry.label}`, 'info');
}

/** Redo one step and say what came back. */
export function redoWithToast(): void {
  const entry = useUndoStore.getState().redo();
  if (entry) useAppStore.getState().addToast(`Redid: ${entry.label}`, 'info');
}

/** Move the selected block to the lane above (-1) or below (+1). */
function moveToAdjacentLane(blockId: string, memberId: string, direction: -1 | 1): void {
  const { members, updateBlock } = useAppStore.getState();
  const sorted = [...members].sort((a, b) => a.sortOrder - b.sortOrder);
  const index = sorted.findIndex(m => m.id === memberId);
  if (index < 0) return;
  const target = sorted[index + direction];
  if (!target) return; // already at the top/bottom lane
  updateBlock(blockId, { memberId: target.id });
}

/** Delete the selected block, offering an Undo on the toast. */
function deleteWithUndoToast(blockId: string): void {
  const store = useAppStore.getState();
  store.deleteBlock(blockId);
  // The step the delete just recorded — the toast must undo that one, not
  // whatever the user does in the seconds the toast is on screen.
  const entry = useUndoStore.getState().peek();
  store.addToast('Block deleted', 'info', {
    label: 'Undo',
    onClick: () => {
      const undone = useUndoStore.getState().undoEntry(entry);
      if (undone) useAppStore.getState().addToast(`Undid: ${undone.label}`, 'info');
    },
  });
}

function handleKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  if (isEditableTarget(e.target)) return;

  const store = useAppStore.getState();

  // The cheat sheet swallows everything but its own dismissal.
  if (store.isShortcutsOpen) {
    if (e.key === 'Escape' || e.key === '?') {
      e.preventDefault();
      store.setShortcutsOpen(false);
    }
    return;
  }
  // A modal or the context menu owns the keyboard while it is up.
  if (store.isModalOpen || store.isSettingsOpen || store.isBoardSettingsOpen || store.contextMenu) {
    return;
  }

  if (e.metaKey || e.ctrlKey) {
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      flushNudge();
      undoWithToast();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      flushNudge();
      redoWithToast();
    } else if (key === 'd' && store.selectedBlockId) {
      e.preventDefault();
      flushNudge();
      store.duplicateBlock(store.selectedBlockId);
    }
    return;
  }
  if (e.altKey && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

  if (e.key === '?') {
    e.preventDefault();
    store.setShortcutsOpen(true);
    return;
  }
  if (e.key === 'Escape') {
    store.setSelectedBlock(null);
    return;
  }

  const blockId = store.selectedBlockId;
  if (!blockId) return;
  const block = store.blocks.find(b => b.id === blockId);
  if (!block) return;

  switch (e.key) {
    case 'ArrowLeft':
    case 'ArrowRight': {
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey) {
        // Extend / shrink the end, never past the start.
        const endDate = addDaysToISO(block.endDate, step);
        if (daysBetween(block.startDate, endDate) < 0) return;
        nudgeBlock(blockId, { endDate });
      } else if (e.altKey) {
        // Move the start only, never past the end.
        const startDate = addDaysToISO(block.startDate, step);
        if (daysBetween(startDate, block.endDate) < 0) return;
        nudgeBlock(blockId, { startDate });
      } else {
        nudgeBlock(blockId, {
          startDate: addDaysToISO(block.startDate, step),
          endDate: addDaysToISO(block.endDate, step),
        });
      }
      return;
    }
    case 'ArrowUp':
    case 'ArrowDown': {
      e.preventDefault();
      // The lane change is a write of its own; don't leave a nudge half-applied.
      flushNudge();
      moveToAdjacentLane(blockId, block.memberId, e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    case 'Enter': {
      e.preventDefault();
      flushNudge();
      store.openEditModal(blockId);
      return;
    }
    case 'Delete':
    case 'Backspace': {
      e.preventDefault();
      flushNudge();
      deleteWithUndoToast(blockId);
      return;
    }
  }
}

/** Mounted once, in App. */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
