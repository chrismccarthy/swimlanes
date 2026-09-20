import { useAppStore } from './useAppStore';
import type { Block } from '../types';

/**
 * Holding an arrow key fires a keydown every few dozen milliseconds. Each one
 * moves the block on screen immediately, but the write is deferred until the
 * key stops repeating, so a burst of presses costs one conditional update (and
 * one undo step) instead of dozens that would race each other.
 *
 * The block is locked for the duration, exactly as a pointer drag locks it:
 * realtime events skip locked blocks, and `commitBlock` sends the version the
 * block had before the burst started.
 */
export const NUDGE_DEBOUNCE_MS = 400;

type NudgePatch = Partial<Pick<Block, 'startDate' | 'endDate'>>;

let pendingBlockId: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Apply `patch` to the block now, and schedule the persisted write.
 * Nudging a different block flushes the one in flight first.
 */
export function nudgeBlock(id: string, patch: NudgePatch): void {
  const store = useAppStore.getState();
  if (!store.isOnline) {
    store.addToast('Cannot save while offline', 'error');
    return;
  }
  if (!store.blocks.some(b => b.id === id)) return;

  if (pendingBlockId !== null && pendingBlockId !== id) flushNudge();

  if (pendingBlockId === null) {
    pendingBlockId = id;
    store.lockBlock(id);
  }

  // The block is locked, so this is an optimistic move only — no write, and
  // `updatedAt` is left at the version the burst started from.
  useAppStore.getState().updateBlock(id, patch);

  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(flushNudge, NUDGE_DEBOUNCE_MS);
}

/**
 * Write out a pending nudge right away. Called by the debounce timer, and by
 * any other keyboard action so it does not run against a half-written block.
 */
export function flushNudge(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const id = pendingBlockId;
  if (id === null) return;
  pendingBlockId = null;

  const store = useAppStore.getState();
  store.unlockBlock(id);
  store.commitBlock(id);
}

/** True while a nudge is waiting to be written — for tests. */
export function hasPendingNudge(): boolean {
  return pendingBlockId !== null;
}

/** Drop a pending nudge without writing it — for tests. */
export function resetNudgeForTest(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (pendingBlockId !== null) useAppStore.getState().unlockBlock(pendingBlockId);
  pendingBlockId = null;
}
