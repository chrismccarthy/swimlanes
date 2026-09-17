import { useMemo } from 'react';
import { isWeekend, daysBetween } from '../../lib/dates';
import { computeSprintBoundaries, getSprintLabel } from '../../lib/sprints';
import { HEADER_HEIGHT, computeHeaderSegments, computeTickOffsets } from '../../lib/layout';
import type { ZoomLevel } from '../../types';
import { isoToday } from '../../lib/dates';
import styles from './TimelineHeader.module.css';

interface TimelineHeaderProps {
  renderStartDate: string;
  renderEndDate: string;
  sprintAnchorDate: string;
  sprintLengthDays: number;
  totalDays: number;
  zoom: ZoomLevel;
  dayWidth: number;
}

export function TimelineHeader({
  renderStartDate,
  renderEndDate,
  sprintAnchorDate,
  sprintLengthDays,
  totalDays,
  zoom,
  dayWidth,
}: TimelineHeaderProps) {
  const today = isoToday();

  const segments = useMemo(
    () => computeHeaderSegments(renderStartDate, totalDays, zoom),
    [renderStartDate, totalDays, zoom]
  );

  // At day zoom every segment is already a cell boundary, so no extra ticks.
  const ticks = useMemo(
    () => (zoom === 'day' ? [] : computeTickOffsets(renderStartDate, totalDays, zoom)),
    [renderStartDate, totalDays, zoom]
  );

  const sprints = useMemo(
    () => computeSprintBoundaries(renderStartDate, renderEndDate, sprintAnchorDate, sprintLengthDays),
    [renderStartDate, renderEndDate, sprintAnchorDate, sprintLengthDays]
  );

  return (
    <div className={styles.header} style={{ height: HEADER_HEIGHT }}>
      {/* Sprint labels row */}
      <div className={styles.sprintRow}>
        {sprints.map(sprint => {
          // Use daysBetween for reliable offset calculation (works even when dates are outside the range)
          const startOffset = daysBetween(renderStartDate, sprint.startDate);
          const endOffset = daysBetween(renderStartDate, sprint.endDate);
          // Clamp to visible range
          const visibleStart = Math.max(0, startOffset);
          const visibleEnd = Math.min(totalDays - 1, endOffset);
          const left = visibleStart * dayWidth;
          const width = (visibleEnd - visibleStart + 1) * dayWidth;
          if (width <= 0) return null;

          return (
            <div
              key={sprint.startDate}
              className={styles.sprintLabel}
              style={{ left, width }}
            >
              {getSprintLabel(sprint.startDate, today, sprintAnchorDate, sprintLengthDays)}
            </div>
          );
        })}
      </div>

      {/* Period labels row — days, weeks or months depending on zoom */}
      <div className={styles.dayRow}>
        {ticks.map(offset => (
          <div
            key={`tick-${offset}`}
            className={styles.tick}
            style={{ left: offset * dayWidth }}
          />
        ))}
        {segments.map(segment =>
          zoom === 'day' ? (
            <div
              key={segment.date}
              className={`${styles.dayCell} ${isWeekend(segment.date) ? styles.weekend : ''} ${segment.date === today ? styles.today : ''}`}
              style={{ left: segment.offsetDays * dayWidth, width: segment.spanDays * dayWidth }}
            >
              <span className={styles.dayNumber}>{segment.label}</span>
              <span className={styles.dayOfWeek}>{segment.subLabel}</span>
            </div>
          ) : (
            <div
              key={segment.date}
              className={styles.periodCell}
              style={{ left: segment.offsetDays * dayWidth, width: segment.spanDays * dayWidth }}
              title={segment.label}
            >
              <span className={styles.periodLabel}>{segment.label}</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}
