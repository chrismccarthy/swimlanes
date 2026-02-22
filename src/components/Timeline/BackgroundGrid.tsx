import { useMemo } from 'react';
import { generateDateRange, isWeekend, daysBetween } from '../../lib/dates';
import { computeSprintBoundaries } from '../../lib/sprints';
import { DAY_WIDTH } from '../../lib/layout';
import styles from './BackgroundGrid.module.css';

interface BackgroundGridProps {
  renderStartDate: string;
  renderEndDate: string;
  sprintAnchorDate: string;
  sprintLengthDays: number;
  totalDays: number;
  totalHeight: number;
}

export function BackgroundGrid({
  renderStartDate,
  renderEndDate,
  sprintAnchorDate,
  sprintLengthDays,
  totalDays,
  totalHeight,
}: BackgroundGridProps) {
  const dates = useMemo(
    () => generateDateRange(renderStartDate, totalDays),
    [renderStartDate, totalDays]
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
        const left = visibleStart * DAY_WIDTH;
        const width = (visibleEnd - visibleStart + 1) * DAY_WIDTH;
        if (width <= 0) return null;

        return (
          <div
            key={sprint.startDate}
            className={`${styles.sprintBand} ${sprint.sprintNumber % 2 === 0 ? styles.even : ''}`}
            style={{ left, width, height: totalHeight }}
          />
        );
      })}

      {/* Weekend shading */}
      {dates.map((date, i) =>
        isWeekend(date) ? (
          <div
            key={`wknd-${date}`}
            className={styles.weekendColumn}
            style={{
              left: i * DAY_WIDTH,
              width: DAY_WIDTH,
              height: totalHeight,
            }}
          />
        ) : null
      )}

      {/* Day grid lines */}
      {dates.map((_, i) => (
        <div
          key={`line-${i}`}
          className={styles.dayLine}
          style={{ left: i * DAY_WIDTH, height: totalHeight }}
        />
      ))}
    </div>
  );
}
