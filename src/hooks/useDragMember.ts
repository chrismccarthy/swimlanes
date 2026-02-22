import { useCallback, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';

const DRAG_THRESHOLD = 3;

export function useDragMember(memberId: string) {
  const isDragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    if (!useAppStore.getState().isOnline) return;

    const startY = e.clientY;
    isDragging.current = false;

    // Find the member list container and all member row elements
    const handle = e.currentTarget as HTMLElement;
    const memberRow = handle.closest('[data-member-id]') as HTMLElement | null;
    if (!memberRow) return;
    const memberList = memberRow.parentElement;
    if (!memberList) return;

    // Create a drop indicator element
    const indicator = document.createElement('div');
    indicator.style.cssText = 'position:absolute;left:8px;right:8px;height:2px;background:#3b82f6;border-radius:1px;pointer-events:none;z-index:100;display:none;';
    memberList.style.position = 'relative';
    memberList.appendChild(indicator);

    let dropIndex = -1;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const distance = Math.abs(deltaY);

      if (!isDragging.current && distance < DRAG_THRESHOLD) return;

      if (!isDragging.current) {
        isDragging.current = true;
        memberRow.style.opacity = '0.4';
        handle.style.cursor = 'grabbing';
        document.body.style.cursor = 'grabbing';
      }

      // Find the closest gap between member rows
      const rows = Array.from(memberList.querySelectorAll('[data-member-id]')) as HTMLElement[];
      const sortedMembers = [...useAppStore.getState().members].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );
      const cursorY = moveEvent.clientY;

      // Calculate drop position
      let bestIndex = 0;
      let bestDist = Infinity;
      const listRect = memberList.getBoundingClientRect();

      for (let i = 0; i <= rows.length; i++) {
        let gapY: number;
        if (i === 0) {
          gapY = rows[0].getBoundingClientRect().top;
        } else if (i === rows.length) {
          gapY = rows[rows.length - 1].getBoundingClientRect().bottom;
        } else {
          const prev = rows[i - 1].getBoundingClientRect();
          const next = rows[i].getBoundingClientRect();
          gapY = (prev.bottom + next.top) / 2;
        }
        const dist = Math.abs(cursorY - gapY);
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = i;
        }
      }

      dropIndex = bestIndex;

      // Position the indicator
      indicator.style.display = 'block';
      if (bestIndex === 0) {
        indicator.style.top = (rows[0].getBoundingClientRect().top - listRect.top - 1) + 'px';
      } else if (bestIndex === rows.length) {
        indicator.style.top = (rows[rows.length - 1].getBoundingClientRect().bottom - listRect.top - 1) + 'px';
      } else {
        const prev = rows[bestIndex - 1].getBoundingClientRect();
        const next = rows[bestIndex].getBoundingClientRect();
        indicator.style.top = ((prev.bottom + next.top) / 2 - listRect.top - 1) + 'px';
      }

      // Skip showing indicator at the member's current position (no-op drop)
      const currentIndex = sortedMembers.findIndex(m => m.id === memberId);
      if (bestIndex === currentIndex || bestIndex === currentIndex + 1) {
        indicator.style.display = 'none';
      }
    };

    const cleanup = () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', cleanup);
      memberRow.style.opacity = '';
      handle.style.cursor = '';
      document.body.style.cursor = '';
      if (indicator.parentNode) indicator.remove();
    };

    const onPointerUp = () => {
      cleanup();

      if (!isDragging.current) {
        isDragging.current = false;
        return;
      }
      isDragging.current = false;

      if (dropIndex < 0) return;

      const sortedMembers = [...useAppStore.getState().members].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );
      const currentIndex = sortedMembers.findIndex(m => m.id === memberId);

      // No-op if dropped at same position
      if (dropIndex === currentIndex || dropIndex === currentIndex + 1) return;

      // Calculate new sortOrder as midpoint between neighbors
      let newSortOrder: number;
      if (dropIndex === 0) {
        newSortOrder = sortedMembers[0].sortOrder - 1;
      } else if (dropIndex >= sortedMembers.length) {
        newSortOrder = sortedMembers[sortedMembers.length - 1].sortOrder + 1;
      } else {
        // Adjust indices: if dropping below original position, the indices shift
        const adjustedIndex = dropIndex > currentIndex ? dropIndex : dropIndex;
        const before = sortedMembers.filter(m => m.id !== memberId);
        const aboveIdx = adjustedIndex > currentIndex ? adjustedIndex - 2 : adjustedIndex - 1;
        const belowIdx = aboveIdx + 1;

        if (aboveIdx < 0) {
          newSortOrder = before[0].sortOrder - 1;
        } else if (belowIdx >= before.length) {
          newSortOrder = before[before.length - 1].sortOrder + 1;
        } else {
          newSortOrder = (before[aboveIdx].sortOrder + before[belowIdx].sortOrder) / 2;
        }
      }

      useAppStore.getState().moveMember(memberId, newSortOrder);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', cleanup);
  }, [memberId]);

  return { onPointerDown, isDragging };
}
