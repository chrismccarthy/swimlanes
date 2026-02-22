import { useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { DAY_WIDTH } from '../lib/layout';
import { addDaysToISO } from '../lib/dates';

export type ResizeSide = 'left' | 'right';

export function useResizeBlock(blockId: string, side: ResizeSide) {
  const updateBlock = useAppStore(s => s.updateBlock);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    // Bail if offline
    if (!useAppStore.getState().isOnline) return;

    const startX = e.clientX;
    const block = useAppStore.getState().blocks.find(b => b.id === blockId);
    if (!block) return;

    const originalStartDate = block.startDate;
    const originalEndDate = block.endDate;

    useAppStore.getState().lockBlock(blockId);

    const onPointerMove = (e: PointerEvent) => {
      const deltaX = e.clientX - startX;
      const deltaDays = Math.round(deltaX / DAY_WIDTH);

      if (side === 'left') {
        const newStart = addDaysToISO(originalStartDate, deltaDays);
        // Don't let start go past end
        if (newStart <= originalEndDate) {
          updateBlock(blockId, { startDate: newStart });
        }
      } else {
        const newEnd = addDaysToISO(originalEndDate, deltaDays);
        // Don't let end go before start
        if (newEnd >= originalStartDate) {
          updateBlock(blockId, { endDate: newEnd });
        }
      }
    };

    const onPointerUp = () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      useAppStore.getState().unlockBlock(blockId);
      useAppStore.getState().commitBlock(blockId);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }, [blockId, side, updateBlock]);

  return { onPointerDown };
}
