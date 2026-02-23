import { useMemo, useCallback } from 'react';
import type { Block as BlockType, Member } from '../../types';
import { assignTracks, computeRowHeight, dateToX, xToDate, BLOCK_HEIGHT, BLOCK_GAP, DAY_WIDTH } from '../../lib/layout';
import { addDaysToISO, daysBetween } from '../../lib/dates';
import { useAppStore } from '../../store/useAppStore';
import { useDragCreateBlock } from '../../hooks/useDragCreateBlock';
import { Block } from './Block';
import styles from './SwimLane.module.css';

interface SwimLaneProps {
  member: Member;
  blocks: BlockType[];
  renderStartDate: string;
}

export function SwimLane({ member, blocks, renderStartDate }: SwimLaneProps) {
  const openNewBlockModal = useAppStore(s => s.openNewBlockModal);
  const { onPointerDown: onDragCreatePointerDown, dragState } = useDragCreateBlock(member.id, renderStartDate);

  const { assignments, trackCount } = useMemo(
    () => assignTracks(blocks),
    [blocks]
  );

  const rowHeight = computeRowHeight(trackCount);

  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only fire on the lane background, not on blocks
    if ((e.target as HTMLElement).closest('[class*="block_"]')) return;

    // Calculate which date was clicked based on x position within the scrollable area
    const laneRect = e.currentTarget.getBoundingClientRect();
    const relativeX = e.clientX - laneRect.left;
    const clickedDate = xToDate(relativeX, renderStartDate);

    // Pre-generate the ID so we can reference it immediately
    const id = crypto.randomUUID();
    const newBlock = {
      id,
      memberId: member.id,
      title: 'New Block',
      startDate: addDaysToISO(clickedDate, -1),
      endDate: addDaysToISO(clickedDate, 1),
      color: 'blue' as const,
    };

    openNewBlockModal(newBlock);
  }, [member.id, renderStartDate, openNewBlockModal]);

  // Compute preview rectangle position
  const previewStyle = dragState.isCreating && dragState.previewStartDate && dragState.previewEndDate
    ? {
        left: dateToX(dragState.previewStartDate, renderStartDate),
        width: (daysBetween(dragState.previewStartDate, dragState.previewEndDate) + 1) * DAY_WIDTH,
        top: BLOCK_GAP + trackCount * (BLOCK_HEIGHT + BLOCK_GAP),
        height: BLOCK_HEIGHT,
      }
    : null;

  return (
    <div
      className={styles.lane}
      style={{ height: rowHeight }}
      data-member-id={member.id}
      onDoubleClick={handleDoubleClick}
      onPointerDown={onDragCreatePointerDown}
    >
      {assignments.map(({ block, trackIndex }) => (
        <Block
          key={block.id}
          block={block}
          trackIndex={trackIndex}
          renderStartDate={renderStartDate}
        />
      ))}
      {previewStyle && (
        <div className={styles.previewBlock} style={previewStyle} />
      )}
    </div>
  );
}
