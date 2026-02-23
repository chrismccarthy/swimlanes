import { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { DAY_WIDTH, xToDate } from '../lib/layout';

const DRAG_THRESHOLD = 3; // px before considering it a drag

interface DragCreateState {
  previewStartDate: string | null;
  previewEndDate: string | null;
  isCreating: boolean;
}

export function useDragCreateBlock(memberId: string, renderStartDate: string) {
  const openNewBlockModal = useAppStore(s => s.openNewBlockModal);
  const [dragState, setDragState] = useState<DragCreateState>({
    previewStartDate: null,
    previewEndDate: null,
    isCreating: false,
  });
  const isDragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only left button, and only on empty lane background (not on blocks)
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[class*="block"]')) return;

    // Bail if offline
    if (!useAppStore.getState().isOnline) return;

    const startX = e.clientX;
    const laneRect = e.currentTarget.getBoundingClientRect();
    const relativeStartX = e.clientX - laneRect.left;
    isDragging.current = false;

    // We need to capture the lane element for rect calculations during move
    const laneEl = e.currentTarget;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const distance = Math.abs(deltaX);

      if (!isDragging.current && distance < DRAG_THRESHOLD) return;

      if (!isDragging.current) {
        isDragging.current = true;
      }

      // Calculate current relative X within the lane
      const currentLaneRect = laneEl.getBoundingClientRect();
      const relativeCurrentX = moveEvent.clientX - currentLaneRect.left;

      // Snap both positions to day boundaries
      const snappedStartDays = Math.floor(relativeStartX / DAY_WIDTH);
      const snappedCurrentDays = Math.floor(relativeCurrentX / DAY_WIDTH);

      // Handle reverse drag: ensure start <= end
      const minDays = Math.min(snappedStartDays, snappedCurrentDays);
      const maxDays = Math.max(snappedStartDays, snappedCurrentDays);

      const startDate = xToDate(minDays * DAY_WIDTH, renderStartDate);
      const endDate = xToDate(maxDays * DAY_WIDTH, renderStartDate);

      setDragState({
        previewStartDate: startDate,
        previewEndDate: endDate,
        isCreating: true,
      });
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);

      if (!isDragging.current) {
        // No drag occurred (< 3px movement) — do nothing, let dblclick handle it
        setDragState({ previewStartDate: null, previewEndDate: null, isCreating: false });
        return;
      }

      // Calculate final dates
      const currentLaneRect = laneEl.getBoundingClientRect();
      const relativeUpX = upEvent.clientX - currentLaneRect.left;

      const snappedStartDays = Math.floor(relativeStartX / DAY_WIDTH);
      const snappedUpDays = Math.floor(relativeUpX / DAY_WIDTH);

      const totalDelta = Math.abs(upEvent.clientX - startX);

      let startDate: string;
      let endDate: string;

      if (totalDelta < DAY_WIDTH) {
        // Short drag (>= 3px but < 1 day width) — create 1-day block
        const clickedDate = xToDate(snappedStartDays * DAY_WIDTH, renderStartDate);
        startDate = clickedDate;
        endDate = clickedDate;
      } else {
        // Full drag — multi-day block with snapped dates
        const minDays = Math.min(snappedStartDays, snappedUpDays);
        const maxDays = Math.max(snappedStartDays, snappedUpDays);
        startDate = xToDate(minDays * DAY_WIDTH, renderStartDate);
        endDate = xToDate(maxDays * DAY_WIDTH, renderStartDate);
      }

      // Clear preview
      setDragState({ previewStartDate: null, previewEndDate: null, isCreating: false });
      isDragging.current = false;

      // Create block and open modal
      const id = crypto.randomUUID();
      openNewBlockModal({
        id,
        memberId,
        title: 'New Block',
        startDate,
        endDate,
        color: 'blue',
      });
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }, [memberId, renderStartDate, openNewBlockModal]);

  return { onPointerDown, dragState };
}
