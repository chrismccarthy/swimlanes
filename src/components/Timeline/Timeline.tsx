import { useRef, useCallback, useMemo, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useAppStore } from '../../store/useAppStore';
import { daysBetween, isoToday } from '../../lib/dates';
import { dateToX, DAY_WIDTH, assignTracks, computeRowHeight } from '../../lib/layout';
import { TimelineHeader } from './TimelineHeader';
import { BackgroundGrid } from './BackgroundGrid';
import { SwimLane } from './SwimLane';
import { TodayMarker } from './TodayMarker';
import styles from './Timeline.module.css';

const SCROLL_BUFFER = 200; // px from edge to trigger expansion
const EXPANSION_DAYS = 30;

export function Timeline() {
  const members = useAppStore(s => s.members);
  const blocks = useAppStore(s => s.blocks);
  const sprintAnchorDate = useAppStore(s => s.sprintAnchorDate);
  const sprintLengthDays = useAppStore(s => s.sprintLengthDays);
  const renderStartDate = useAppStore(s => s.renderStartDate);
  const renderEndDate = useAppStore(s => s.renderEndDate);
  const expandTimelineBefore = useAppStore(s => s.expandTimelineBefore);
  const expandTimelineAfter = useAppStore(s => s.expandTimelineAfter);
  const setSelectedBlock = useAppStore(s => s.setSelectedBlock);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isExpandingRef = useRef(false);

  const totalDays = daysBetween(renderStartDate, renderEndDate) + 1;
  const contentWidth = totalDays * DAY_WIDTH;

  // Compute total height from all swim lane rows
  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => a.sortOrder - b.sortOrder),
    [members]
  );

  const totalHeight = useMemo(() => {
    let height = 0;
    for (const member of sortedMembers) {
      const memberBlocks = blocks.filter(b => b.memberId === member.id);
      const { trackCount } = assignTracks(memberBlocks);
      height += computeRowHeight(trackCount);
    }
    return Math.max(height, 200); // minimum content height
  }, [sortedMembers, blocks]);

  // Scroll to today on initial mount
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const today = isoToday();
    const todayX = dateToX(today, renderStartDate);
    container.scrollLeft = Math.max(0, todayX - container.clientWidth / 3);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll handler
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || isExpandingRef.current) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;

    // Expand left
    if (scrollLeft < SCROLL_BUFFER) {
      isExpandingRef.current = true;
      const addedWidth = EXPANSION_DAYS * DAY_WIDTH;
      // flushSync forces React to render synchronously so the DOM expands
      // before we adjust scrollLeft — prevents the violent jump bug
      flushSync(() => expandTimelineBefore(EXPANSION_DAYS));
      container.scrollLeft = scrollLeft + addedWidth;
      isExpandingRef.current = false;
    }

    // Expand right
    if (scrollWidth - scrollLeft - clientWidth < SCROLL_BUFFER) {
      isExpandingRef.current = true;
      flushSync(() => expandTimelineAfter(EXPANSION_DAYS));
      isExpandingRef.current = false;
    }
  }, [expandTimelineBefore, expandTimelineAfter]);

  const handleBackgroundClick = useCallback(() => {
    setSelectedBlock(null);
  }, [setSelectedBlock]);

  return (
    <div
      ref={scrollContainerRef}
      className={styles.container}
      onScroll={handleScroll}
      onClick={handleBackgroundClick}
    >
      <div className={styles.content} style={{ width: contentWidth }}>
        <TimelineHeader
          renderStartDate={renderStartDate}
          renderEndDate={renderEndDate}
          sprintAnchorDate={sprintAnchorDate}
          sprintLengthDays={sprintLengthDays}
          totalDays={totalDays}
        />
        <div className={styles.body} style={{ position: 'relative' }}>
          <BackgroundGrid
            renderStartDate={renderStartDate}
            renderEndDate={renderEndDate}
            sprintAnchorDate={sprintAnchorDate}
            sprintLengthDays={sprintLengthDays}
            totalDays={totalDays}
            totalHeight={totalHeight}
          />
          <TodayMarker
            renderStartDate={renderStartDate}
            totalHeight={totalHeight}
          />
          {sortedMembers.map(member => {
            const memberBlocks = blocks.filter(b => b.memberId === member.id);
            return (
              <SwimLane
                key={member.id}
                member={member}
                blocks={memberBlocks}
                renderStartDate={renderStartDate}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
