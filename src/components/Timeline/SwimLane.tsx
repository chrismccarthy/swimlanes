import { useMemo, useCallback } from 'react';
import type { Block as BlockType, Member, ZoomLevel } from '../../types';
import {
  assignTracks,
  computeRowHeight,
  dateToX,
  xToDate,
  BLOCK_HEIGHT,
  BLOCK_GAP,
  CAPACITY_STRIP_HEIGHT,
} from '../../lib/layout';
import { addDaysToISO, daysBetween } from '../../lib/dates';
import { useAppStore } from '../../store/useAppStore';
import { useDragCreateBlock } from '../../hooks/useDragCreateBlock';
import { useMemberCapacityStrip } from '../../hooks/useCapacity';
import { Block } from './Block';
import { CapacityStrip } from './CapacityStrip';
import styles from './SwimLane.module.css';

interface SwimLaneProps {
  member: Member;
  blocks: BlockType[];
  renderStartDate: string;
  zoom: ZoomLevel;
  dayWidth: number;
}

export function SwimLane({ member, blocks, renderStartDate, zoom, dayWidth }: SwimLaneProps) {
  const openNewBlockModal = useAppStore(s => s.openNewBlockModal);
  const { onPointerDown: onDragCreatePointerDown, dragState } = useDragCreateBlock(member.id, renderStartDate);

  const { assignments, trackCount } = useMemo(
    () => assignTracks(blocks),
    [blocks]
  );

  // The capacity strip takes a band off the top of the row; the tracks below
  // it are pushed down by the same amount so nothing overlaps.
  const capacity = useMemberCapacityStrip(member.id);
  const capacityOffset = capacity ? CAPACITY_STRIP_HEIGHT : 0;
  const rowHeight = computeRowHeight(trackCount, capacityOffset);

  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only fire on the lane background, not on blocks
    if ((e.target as HTMLElement).closest('[class*="block_"]')) return;

    // Calculate which date was clicked based on x position within the scrollable area
    const laneRect = e.currentTarget.getBoundingClientRect();
    const relativeX = e.clientX - laneRect.left;
    const clickedDate = xToDate(relativeX, renderStartDate, dayWidth);

    // Pre-generate the ID so we can reference it immediately
    const id = crypto.randomUUID();
    const newBlock = {
      id,
      memberId: member.id,
      title: 'New Block',
      startDate: addDaysToISO(clickedDate, -1),
      endDate: addDaysToISO(clickedDate, 1),
      color: 'blue' as const,
      tags: [],
      // Provisional: replaced by the server's value once the block is inserted.
      updatedAt: new Date().toISOString(),
    };

    openNewBlockModal(newBlock);
  }, [member.id, renderStartDate, dayWidth, openNewBlockModal]);

  // Compute preview rectangle position
  const previewStyle = dragState.isCreating && dragState.previewStartDate && dragState.previewEndDate
    ? {
        left: dateToX(dragState.previewStartDate, renderStartDate, dayWidth),
        width: (daysBetween(dragState.previewStartDate, dragState.previewEndDate) + 1) * dayWidth,
        top: BLOCK_GAP + trackCount * (BLOCK_HEIGHT + BLOCK_GAP),
        height: BLOCK_HEIGHT,
      }
    : null;

  return (
    <div
      className={styles.lane}
      style={{ height: rowHeight }}
      data-testid="swimlane"
      data-member-id={member.id}
      onDoubleClick={handleDoubleClick}
      onPointerDown={onDragCreatePointerDown}
    >
      {capacity && (
        <CapacityStrip
          sprints={capacity.sprints}
          figures={capacity.figures}
          renderStartDate={renderStartDate}
          totalDays={capacity.totalDays}
          dayWidth={dayWidth}
          showText={zoom !== 'quarter'}
        />
      )}
      <div className={styles.tracks} style={{ top: capacityOffset }}>
        {assignments.map(({ block, trackIndex }) => (
          <Block
            key={block.id}
            block={block}
            trackIndex={trackIndex}
            renderStartDate={renderStartDate}
            zoom={zoom}
            dayWidth={dayWidth}
          />
        ))}
        {previewStyle && (
          <div className={styles.previewBlock} style={previewStyle} />
        )}
      </div>
    </div>
  );
}
