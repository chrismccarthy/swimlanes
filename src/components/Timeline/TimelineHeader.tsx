import { useMemo } from 'react';
import { generateDateRange, formatDayLabel, getDayOfWeek, isWeekend, daysBetween } from '../../lib/dates';
import { computeSprintBoundaries, getSprintLabel } from '../../lib/sprints';
import { DAY_WIDTH, HEADER_HEIGHT } from '../../lib/layout';
import { isoToday } from '../../lib/dates';
import styles from './TimelineHeader.module.css';

interface TimelineHeaderProps {
  renderStartDate: string;
  renderEndDate: string;
  sprintAnchorDate: string;
  sprintLengthDays: number;
  totalDays: number;
}

export function TimelineHeader({
  renderStartDate,
  renderEndDate,
  sprintAnchorDate,
  sprintLengthDays,
  totalDays,
}: TimelineHeaderProps) {
  const today = isoToday();

  const dates = useMemo(
    () => generateDateRange(renderStartDate, totalDays),
    [renderStartDate, totalDays]
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
          const left = visibleStart * DAY_WIDTH;
          const width = (visibleEnd - visibleStart + 1) * DAY_WIDTH;
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

      {/* Day labels row */}
      <div className={styles.dayRow}>
        {dates.map((date, i) => (
          <div
            key={date}
            className={`${styles.dayCell} ${isWeekend(date) ? styles.weekend : ''} ${date === today ? styles.today : ''}`}
            style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
          >
            <span className={styles.dayNumber}>
              {formatDayLabel(date, i > 0 ? dates[i - 1] : null)}
            </span>
            <span className={styles.dayOfWeek}>{getDayOfWeek(date)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
