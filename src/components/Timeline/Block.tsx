import type { Block as BlockType, ZoomLevel } from '../../types';
import { BLOCK_COLORS } from '../../lib/colors';
import { dateToX, BLOCK_HEIGHT, MIN_TITLE_WIDTH, blockTopOffset, visibleTagCount } from '../../lib/layout';
import { daysBetween, formatShortDate } from '../../lib/dates';
import { matchesActiveTags } from '../../lib/tags';
import { useAppStore } from '../../store/useAppStore';
import { useDragBlock } from '../../hooks/useDragBlock';
import { useResizeBlock } from '../../hooks/useResizeBlock';
import { ResizeHandle } from './ResizeHandle';
import styles from './Block.module.css';

interface BlockProps {
  block: BlockType;
  trackIndex: number;
  renderStartDate: string;
  zoom: ZoomLevel;
  dayWidth: number;
}

export function Block({ block, trackIndex, renderStartDate, zoom, dayWidth }: BlockProps) {
  const openEditModal = useAppStore(s => s.openEditModal);
  const setContextMenu = useAppStore(s => s.setContextMenu);
  const selectedBlockId = useAppStore(s => s.selectedBlockId);
  const setSelectedBlock = useAppStore(s => s.setSelectedBlock);
  const draggingBlockId = useAppStore(s => s.draggingBlockId);
  const memberName = useAppStore(s => s.members.find(m => m.id === block.memberId)?.name ?? '');
  const activeTags = useAppStore(s => s.activeTags);

  const isBeingDragged = draggingBlockId === block.id;
  // Filtered-out blocks are dimmed, never hidden: lanes keep their tracks and
  // their height, so the shape of the board does not jump as you filter.
  const isDimmed = !matchesActiveTags(block.tags, activeTags);

  const colors = BLOCK_COLORS[block.color];
  const left = dateToX(block.startDate, renderStartDate, dayWidth);
  const durationDays = daysBetween(block.startDate, block.endDate) + 1; // inclusive
  const width = Math.max(durationDays * dayWidth, dayWidth);
  const top = blockTopOffset(trackIndex);
  const isSelected = selectedBlockId === block.id;

  // Keep the label from spilling out of a narrow block: pad less when days are
  // thin, and drop the text entirely when there is no room for even a glyph —
  // the title attribute still surfaces it as a tooltip.
  const isCompact = zoom !== 'day';
  const showTitle = width >= MIN_TITLE_WIDTH;
  const handleWidth = isCompact ? Math.max(3, Math.round(dayWidth / 4)) : 8;
  const paddingX = isCompact ? 3 : 10;

  // Tag chips share the block with the title, so only a block that is wide
  // enough shows any; the rest of them become a "+N" and live in the tooltip.
  const tagSlots = showTitle ? visibleTagCount(width, zoom) : 0;
  const shownTags = block.tags.slice(0, tagSlots);
  const hiddenTagCount = block.tags.length - shownTags.length;
  const tooltip = block.tags.length > 0
    ? `${block.title} — ${block.tags.join(', ')}`
    : block.title;

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

  // Tabbing to a block selects it, so the keyboard shortcuts act on whatever
  // has the focus ring (see useKeyboardShortcuts).
  const handleFocus = () => {
    setSelectedBlock(block.id);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ blockId: block.id, x: e.clientX, y: e.clientY });
  };

  return (
    <div
      className={`${styles.block} ${isSelected ? styles.selected : ''}`}
      data-testid="block"
      data-block-id={block.id}
      data-selected={isSelected ? 'true' : undefined}
      tabIndex={0}
      role="button"
      aria-label={`${block.title}${memberName ? `, ${memberName}` : ''}, ${formatShortDate(block.startDate)} to ${formatShortDate(block.endDate)}`}
      style={{
        left,
        width,
        top,
        height: BLOCK_HEIGHT,
        paddingLeft: paddingX,
        paddingRight: paddingX,
        backgroundColor: colors.bg,
        borderColor: colors.border,
        color: colors.text,
        ...(isDimmed ? { opacity: 0.25 } : {}),
        ...(isBeingDragged ? { transition: 'box-shadow 0.15s ease' } : {}),
      }}
      title={tooltip}
      data-dimmed={isDimmed ? 'true' : undefined}
      onClick={handleClick}
      onFocus={handleFocus}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onPointerDown={onDragPointerDown}
    >
      <ResizeHandle side="left" width={handleWidth} onPointerDown={onResizeLeftPointerDown} />
      {showTitle && <span className={styles.title}>{block.title}</span>}
      {shownTags.map(tag => (
        <span key={tag} className={styles.tag} data-testid="block-tag">{tag}</span>
      ))}
      {tagSlots > 0 && hiddenTagCount > 0 && (
        <span className={styles.tagOverflow} data-testid="block-tag-overflow">+{hiddenTagCount}</span>
      )}
      <ResizeHandle side="right" width={handleWidth} onPointerDown={onResizeRightPointerDown} />
    </div>
  );
}
