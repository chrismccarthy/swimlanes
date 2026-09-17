import { useMemo } from 'react';
import { generateDateRange, isWeekend, daysBetween } from '../../lib/dates';
import { computeSprintBoundaries } from '../../lib/sprints';
import { computeTickOffsets, showsWeekendShading } from '../../lib/layout';
import type { ZoomLevel } from '../../types';
import styles from './BackgroundGrid.module.css';

interface BackgroundGridProps {
  renderStartDate: string;
  renderEndDate: string;
  sprintAnchorDate: string;
  sprintLengthDays: number;
  totalDays: number;
  totalHeight: number;
  zoom: ZoomLevel;
  dayWidth: number;
}

export function BackgroundGrid({
  renderStartDate,
  renderEndDate,
  sprintAnchorDate,
  sprintLengthDays,
  totalDays,
  totalHeight,
  zoom,
  dayWidth,
}: BackgroundGridProps) {
  const showWeekends = showsWeekendShading(zoom);

  const dates = useMemo(
    () => (showWeekends ? generateDateRange(renderStartDate, totalDays) : []),
    [renderStartDate, totalDays, showWeekends]
  );

  const ticks = useMemo(
    () => computeTickOffsets(renderStartDate, totalDays, zoom),
    [renderStartDate, totalDays, zoom]
  );

  const sprints = useMemo(
    () => computeSprintBoundaries(renderStartDate, renderEndDate, sprintAnchorDate, sprintLengthDays),
    [renderStartDate, renderEndDate, sprintAnchorDate, sprintLengthDays]
  );

  return (
    <div className={styles.grid} style={{ height: totalHeight }}>
      {/* Sprint alternating bands */}
      {sprints.map((sprint) => {
        const startOffset = daysBetween(renderStartDate, sprint.startDate);
        const endOffset = daysBetween(renderStartDate, sprint.endDate);
        const visibleStart = Math.max(0, startOffset);
        const visibleEnd = Math.min(totalDays - 1, endOffset);
        const left = visibleStart * dayWidth;
        const width = (visibleEnd - visibleStart + 1) * dayWidth;
        if (width <= 0) return null;

        return (
          <div
            key={sprint.startDate}
            className={`${styles.sprintBand} ${sprint.sprintNumber % 2 === 0 ? styles.even : ''}`}
            style={{ left, width, height: totalHeight }}
          />
        );
      })}

      {/* Weekend shading — dropped at quarter zoom, where it would be solid noise */}
      {dates.map((date, i) =>
        isWeekend(date) ? (
          <div
            key={`wknd-${date}`}
            className={styles.weekendColumn}
            style={{
              left: i * dayWidth,
              width: dayWidth,
              height: totalHeight,
            }}
          />
        ) : null
      )}

      {/* Grid lines — one per day, or one per week at quarter zoom */}
      {ticks.map(offset => (
        <div
          key={`line-${offset}`}
          className={styles.dayLine}
          style={{ left: offset * dayWidth, height: totalHeight }}
        />
      ))}
    </div>
  );
}
