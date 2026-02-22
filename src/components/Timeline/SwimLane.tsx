import { useMemo, useCallback } from 'react';
import type { Block as BlockType, Member } from '../../types';
import { assignTracks, computeRowHeight, DAY_WIDTH, xToDate } from '../../lib/layout';
import { addDaysToISO } from '../../lib/dates';
import { useAppStore } from '../../store/useAppStore';
import { Block } from './Block';
import styles from './SwimLane.module.css';

interface SwimLaneProps {
  member: Member;
  blocks: BlockType[];
  renderStartDate: string;
}

export function SwimLane({ member, blocks, renderStartDate }: SwimLaneProps) {
  const addBlock = useAppStore(s => s.addBlock);
  const openEditModal = useAppStore(s => s.openEditModal);

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

    // Create a new 3-day block at the clicked date
    const newBlock = {
      memberId: member.id,
      title: 'New Block',
      startDate: clickedDate,
      endDate: addDaysToISO(clickedDate, 2),
      color: 'blue' as const,
    };

    // Add the block and get the new block ID from the store
    addBlock(newBlock);

    // Open edit modal for the newly created block (it'll be the last one added)
    // Use setTimeout to let state update first
    setTimeout(() => {
      const state = useAppStore.getState();
      const lastBlock = state.blocks[state.blocks.length - 1];
      if (lastBlock) {
        useAppStore.getState().openEditModal(lastBlock.id);
      }
    }, 0);
  }, [member.id, renderStartDate, addBlock, openEditModal]);

  return (
    <div
      className={styles.lane}
      style={{ height: rowHeight }}
      data-member-id={member.id}
      onDoubleClick={handleDoubleClick}
    >
      {assignments.map(({ block, trackIndex }) => (
        <Block
          key={block.id}
          block={block}
          trackIndex={trackIndex}
          renderStartDate={renderStartDate}
        />
      ))}
    </div>
  );
}
