import { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { DAY_WIDTH, DRAG_THRESHOLD } from '../lib/layout';
import { addDaysToISO } from '../lib/dates';

interface DragCreateState {
  previewStartDate: string | null;
  previewEndDate: string | null;
  isCreating: boolean;
}

const IDLE: DragCreateState = { previewStartDate: null, previewEndDate: null, isCreating: false };

export function useDragCreateBlock(memberId: string, renderStartDate: string) {
  const openNewBlockModal = useAppStore(s => s.openNewBlockModal);
  const [dragState, setDragState] = useState<DragCreateState>(IDLE);
  const isDragging = useRef(false);
  const lastSnappedRef = useRef<{ start: number; end: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only left button, and only on empty lane background (not on blocks)
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[class*="block"]')) return;

    // Bail if offline
    if (!useAppStore.getState().isOnline) return;

    const startX = e.clientX;
    // Capture lane rect once — the lane doesn't move during a drag
    const laneRect = e.currentTarget.getBoundingClientRect();
    const relativeStartX = e.clientX - laneRect.left;
    const snappedStartDays = Math.floor(relativeStartX / DAY_WIDTH);

    isDragging.current = false;
    lastSnappedRef.current = null;

    const cleanup = () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', cleanup);
      setDragState(IDLE);
      isDragging.current = false;
      lastSnappedRef.current = null;
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const distance = Math.abs(moveEvent.clientX - startX);
      if (!isDragging.current && distance < DRAG_THRESHOLD) return;
      isDragging.current = true;

      const relativeCurrentX = moveEvent.clientX - laneRect.left;
      const snappedCurrentDays = Math.floor(relativeCurrentX / DAY_WIDTH);

      // Only re-render when the snapped day boundary actually changes
      const last = lastSnappedRef.current;
      if (last && last.start === snappedStartDays && last.end === snappedCurrentDays) return;
      lastSnappedRef.current = { start: snappedStartDays, end: snappedCurrentDays };

      const minDays = Math.min(snappedStartDays, snappedCurrentDays);
      const maxDays = Math.max(snappedStartDays, snappedCurrentDays);

      setDragState({
        previewStartDate: addDaysToISO(renderStartDate, minDays),
        previewEndDate: addDaysToISO(renderStartDate, maxDays),
        isCreating: true,
      });
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      const wasDragging = isDragging.current;
      cleanup();

      if (!wasDragging) return;

      const totalDelta = Math.abs(upEvent.clientX - startX);
      let startDate: string;
      let endDate: string;

      if (totalDelta < DAY_WIDTH) {
        // Short drag (>= 3px but < 1 day width) — create 1-day block at drag origin
        startDate = addDaysToISO(renderStartDate, snappedStartDays);
        endDate = startDate;
      } else {
        // Full drag — multi-day block with snapped dates
        const relativeUpX = upEvent.clientX - laneRect.left;
        const snappedUpDays = Math.floor(relativeUpX / DAY_WIDTH);
        const minDays = Math.min(snappedStartDays, snappedUpDays);
        const maxDays = Math.max(snappedStartDays, snappedUpDays);
        startDate = addDaysToISO(renderStartDate, minDays);
        endDate = addDaysToISO(renderStartDate, maxDays);
      }

      openNewBlockModal({
        id: crypto.randomUUID(),
        memberId,
        title: 'New Block',
        startDate,
        endDate,
        color: 'blue',
      });
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', cleanup);
  }, [memberId, renderStartDate, openNewBlockModal]);

  return { onPointerDown, dragState };
}
