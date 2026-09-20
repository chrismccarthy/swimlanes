import { useRef, useCallback, useMemo, useEffect, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { useAppStore } from '../../store/useAppStore';
import { daysBetween, isoToday } from '../../lib/dates';
import {
  dateToX,
  assignTracks,
  computeRowHeight,
  expansionDaysForWidth,
  CAPACITY_STRIP_HEIGHT,
} from '../../lib/layout';
import { shouldCrashTimelineOnRender } from '../../lib/timelineCrashHook';
import { TimelineHeader } from './TimelineHeader';
import { BackgroundGrid } from './BackgroundGrid';
import { SwimLane } from './SwimLane';
import { TodayMarker } from './TodayMarker';
import styles from './Timeline.module.css';

const SCROLL_BUFFER = 200; // px from edge to trigger expansion

export function Timeline() {
  if (shouldCrashTimelineOnRender()) {
    throw new Error('Timeline crashed (test hook: ?crash=timeline)');
  }

  const members = useAppStore(s => s.members);
  const blocks = useAppStore(s => s.blocks);
  const sprintAnchorDate = useAppStore(s => s.sprintAnchorDate);
  const sprintLengthDays = useAppStore(s => s.sprintLengthDays);
  const renderStartDate = useAppStore(s => s.renderStartDate);
  const renderEndDate = useAppStore(s => s.renderEndDate);
  const expandTimelineBefore = useAppStore(s => s.expandTimelineBefore);
  const expandTimelineAfter = useAppStore(s => s.expandTimelineAfter);
  const setSelectedBlock = useAppStore(s => s.setSelectedBlock);
  const zoom = useAppStore(s => s.zoom);
  const dayWidth = useAppStore(s => s.dayWidth);
  const capacityEnabled = useAppStore(s => s.capacityEnabled);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isExpandingRef = useRef(false);
  /** Days from renderStartDate that were at the viewport's left edge when zoom changed */
  const zoomAnchorDaysRef = useRef<number | null>(null);

  const totalDays = daysBetween(renderStartDate, renderEndDate) + 1;
  const contentWidth = totalDays * dayWidth;

  // Compute total height from all swim lane rows
  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => a.sortOrder - b.sortOrder),
    [members]
  );

  const totalHeight = useMemo(() => {
    const laneExtra = capacityEnabled ? CAPACITY_STRIP_HEIGHT : 0;
    let height = 0;
    for (const member of sortedMembers) {
      const memberBlocks = blocks.filter(b => b.memberId === member.id);
      const { trackCount } = assignTracks(memberBlocks);
      height += computeRowHeight(trackCount, laneExtra);
    }
    return Math.max(height, 200); // minimum content height
  }, [sortedMembers, blocks, capacityEnabled]);

  // Scroll to today on initial mount
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const mountDayWidth = useAppStore.getState().dayWidth;
    const today = isoToday();
    const todayX = dateToX(today, renderStartDate, mountDayWidth);
    container.scrollLeft = Math.max(0, todayX - container.clientWidth / 3);

    // A zoomed-out range can be narrower than the viewport, which leaves dead
    // space on the right that no scroll event would ever arrive to fill in.
    const currentWidth = totalDays * mountDayWidth;
    const requiredWidth = container.clientWidth + SCROLL_BUFFER;
    if (currentWidth < requiredWidth) {
      expandTimelineAfter(Math.ceil((requiredWidth - currentWidth) / mountDayWidth));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Record the date at the viewport's left edge the instant the zoom changes.
  // Zustand notifies subscribers synchronously inside set(), so this still runs
  // inside the click handler: the DOM — and therefore scrollLeft — is still
  // measured at the *previous* day width, and any extra state change made here
  // is batched into the same render as the zoom change.
  useEffect(() => {
    return useAppStore.subscribe((state, prevState) => {
      if (state.dayWidth === prevState.dayWidth) return;
      const container = scrollContainerRef.current;
      if (!container) return;

      const anchorDays = container.scrollLeft / prevState.dayWidth;
      zoomAnchorDaysRef.current = anchorDays;

      // Zooming out shrinks the content, so the rendered range can end up
      // narrower than the viewport — the browser would then clamp scrollLeft to
      // 0 and the anchor would be lost. Widen the range to the right first;
      // that leaves renderStartDate, and so the anchor offset, untouched.
      const renderedDays = daysBetween(state.renderStartDate, state.renderEndDate) + 1;
      const currentWidth = renderedDays * state.dayWidth;
      const requiredWidth = anchorDays * state.dayWidth + container.clientWidth + SCROLL_BUFFER;
      if (requiredWidth > currentWidth) {
        state.expandTimelineAfter(Math.ceil((requiredWidth - currentWidth) / state.dayWidth));
      }
    });
  }, []);

  // ...then restore that date to the left edge once the new width is laid out.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const anchorDays = zoomAnchorDaysRef.current;
    if (!container || anchorDays === null) return;
    zoomAnchorDaysRef.current = null;
    container.scrollLeft = anchorDays * dayWidth;
  }, [dayWidth]);

  // Infinite scroll handler
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || isExpandingRef.current) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;
    // Expand by a constant number of *pixels*, so a zoomed-out view does not
    // have to expand a dozen times to cover the same amount of screen.
    const expansionDays = expansionDaysForWidth(dayWidth);

    // Expand left
    if (scrollLeft < SCROLL_BUFFER) {
      isExpandingRef.current = true;
      const addedWidth = expansionDays * dayWidth;
      // flushSync forces React to render synchronously so the DOM expands
      // before we adjust scrollLeft — prevents the violent jump bug
      flushSync(() => expandTimelineBefore(expansionDays));
      container.scrollLeft = scrollLeft + addedWidth;
      isExpandingRef.current = false;
    }

    // Expand right
    if (scrollWidth - scrollLeft - clientWidth < SCROLL_BUFFER) {
      isExpandingRef.current = true;
      flushSync(() => expandTimelineAfter(expansionDays));
      isExpandingRef.current = false;
    }
  }, [expandTimelineBefore, expandTimelineAfter, dayWidth]);

  const handleBackgroundClick = useCallback(() => {
    setSelectedBlock(null);
  }, [setSelectedBlock]);

  return (
    <div
      ref={scrollContainerRef}
      className={styles.container}
      onScroll={handleScroll}
      onClick={handleBackgroundClick}
      data-testid="timeline-scroll"
    >
      <div className={styles.content} style={{ width: contentWidth }}>
        <TimelineHeader
          renderStartDate={renderStartDate}
          renderEndDate={renderEndDate}
          sprintAnchorDate={sprintAnchorDate}
          sprintLengthDays={sprintLengthDays}
          totalDays={totalDays}
          zoom={zoom}
          dayWidth={dayWidth}
        />
        <div className={styles.body} style={{ position: 'relative' }}>
          <BackgroundGrid
            renderStartDate={renderStartDate}
            renderEndDate={renderEndDate}
            sprintAnchorDate={sprintAnchorDate}
            sprintLengthDays={sprintLengthDays}
            totalDays={totalDays}
            totalHeight={totalHeight}
            zoom={zoom}
            dayWidth={dayWidth}
          />
          <TodayMarker
            renderStartDate={renderStartDate}
            totalHeight={totalHeight}
            dayWidth={dayWidth}
          />
          {sortedMembers.map(member => {
            const memberBlocks = blocks.filter(b => b.memberId === member.id);
            return (
              <SwimLane
                key={member.id}
                member={member}
                blocks={memberBlocks}
                renderStartDate={renderStartDate}
                zoom={zoom}
                dayWidth={dayWidth}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
