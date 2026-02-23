import type { Block as BlockType } from '../../types';
import { BLOCK_COLORS } from '../../lib/colors';
import { dateToX, DAY_WIDTH, BLOCK_HEIGHT, blockTopOffset } from '../../lib/layout';
import { daysBetween } from '../../lib/dates';
import { useAppStore } from '../../store/useAppStore';
import { useDragBlock } from '../../hooks/useDragBlock';
import { useResizeBlock } from '../../hooks/useResizeBlock';
import { ResizeHandle } from './ResizeHandle';
import styles from './Block.module.css';

interface BlockProps {
  block: BlockType;
  trackIndex: number;
  renderStartDate: string;
}

export function Block({ block, trackIndex, renderStartDate }: BlockProps) {
  const openEditModal = useAppStore(s => s.openEditModal);
  const setContextMenu = useAppStore(s => s.setContextMenu);
  const selectedBlockId = useAppStore(s => s.selectedBlockId);
  const setSelectedBlock = useAppStore(s => s.setSelectedBlock);
  const draggingBlockId = useAppStore(s => s.draggingBlockId);

  const isBeingDragged = draggingBlockId === block.id;

  const colors = BLOCK_COLORS[block.color];
  const left = dateToX(block.startDate, renderStartDate);
  const durationDays = daysBetween(block.startDate, block.endDate) + 1; // inclusive
  const width = durationDays * DAY_WIDTH;
  const top = blockTopOffset(trackIndex);
  const isSelected = selectedBlockId === block.id;

  const { onPointerDown: onDragPointerDown, isDragging } = useDragBlock(block.id);
  const { onPointerDown: onResizeLeftPointerDown } = useResizeBlock(block.id, 'left');
  const { onPointerDown: onResizeRightPointerDown } = useResizeBlock(block.id, 'right');

  const handleClick = (e: React.MouseEvent) => {
    // Don't fire click if we just finished dragging
    if (isDragging.current) return;
    e.stopPropagation();
    setSelectedBlock(block.id);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (isDragging.current) return;
    e.stopPropagation();
    openEditModal(block.id);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ blockId: block.id, x: e.clientX, y: e.clientY });
  };

  return (
    <div
      className={`${styles.block} ${isSelected ? styles.selected : ''}`}
      style={{
        left,
        width: Math.max(width, DAY_WIDTH),
        top,
        height: BLOCK_HEIGHT,
        backgroundColor: colors.bg,
        borderColor: colors.border,
        color: colors.text,
        ...(isBeingDragged ? { transition: 'box-shadow 0.15s ease' } : {}),
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onPointerDown={onDragPointerDown}
    >
      <ResizeHandle side="left" onPointerDown={onResizeLeftPointerDown} />
      <span className={styles.title}>{block.title}</span>
      <ResizeHandle side="right" onPointerDown={onResizeRightPointerDown} />
    </div>
  );
}
