import { useMemo, useCallback } from 'react';
import type { Block as BlockType, Member } from '../../types';
import { assignTracks, computeRowHeight, xToDate } from '../../lib/layout';
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

    addBlock(newBlock);
    useAppStore.setState({ newBlockId: id });
    openEditModal(id);
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
