import { useCallback, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { DAY_WIDTH } from '../lib/layout';
import { addDaysToISO } from '../lib/dates';

const DRAG_THRESHOLD = 3; // px before considering it a drag

export function useDragBlock(blockId: string) {
  const updateBlock = useAppStore(s => s.updateBlock);
  const setDraggingBlock = useAppStore(s => s.setDraggingBlock);
  const isDragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only left button, and not on resize handles
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[class*="handle"]')) return;

    // Bail if offline
    if (!useAppStore.getState().isOnline) return;

    // Don't prevent default or stop propagation yet — let click/doubleClick fire
    const startX = e.clientX;
    const startY = e.clientY;
    const block = useAppStore.getState().blocks.find(b => b.id === blockId);
    if (!block) return;

    const originalStartDate = block.startDate;
    const originalEndDate = block.endDate;
    isDragging.current = false;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      if (!isDragging.current && distance < DRAG_THRESHOLD) return;

      if (!isDragging.current) {
        isDragging.current = true;
        setDraggingBlock(blockId);
        useAppStore.getState().lockBlock(blockId);
        // Now that we know it's a real drag, capture the pointer
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }

      const deltaDays = Math.round(deltaX / DAY_WIDTH);
      updateBlock(blockId, {
        startDate: addDaysToISO(originalStartDate, deltaDays),
        endDate: addDaysToISO(originalEndDate, deltaDays),
      });
    };

    const onPointerUp = () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      if (isDragging.current) {
        useAppStore.getState().unlockBlock(blockId);
        useAppStore.getState().commitBlock(blockId);
        setDraggingBlock(null);
      }
      isDragging.current = false;
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }, [blockId, updateBlock, setDraggingBlock]);

  return { onPointerDown, isDragging };
}
