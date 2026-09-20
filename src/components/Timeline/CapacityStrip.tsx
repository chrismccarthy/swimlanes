import type { SprintBoundary } from '../../types';
import type { CapacityFigure } from '../../lib/capacity';
import { loadLevel } from '../../lib/capacity';
import { rangeGeometry } from '../../lib/layout';
import { isoToday } from '../../lib/dates';
import { CapacityBadge } from './CapacityBadge';
import styles from './Capacity.module.css';

interface CapacityStripProps {
  /** The header's sprint list, so segments line up with the bands exactly. */
  sprints: SprintBoundary[];
  /** One figure per sprint, keyed by `sprint.startDate`. */
  figures: Map<string, CapacityFigure>;
  renderStartDate: string;
  totalDays: number;
  dayWidth: number;
  /** False at quarter zoom, where only the bar fits. */
  showText: boolean;
}

/**
 * A row of per-sprint capacity figures drawn across the top of a swim lane,
 * inside the lane background: behind the blocks and inert to the pointer.
 */
export function CapacityStrip({
  sprints,
  figures,
  renderStartDate,
  totalDays,
  dayWidth,
  showText,
}: CapacityStripProps) {
  const today = isoToday();

  return (
    <div className={styles.strip} aria-hidden="true">
      {sprints.map(sprint => {
        const figure = figures.get(sprint.startDate);
        if (!figure) return null;
        const geometry = rangeGeometry(
          sprint.startDate,
          sprint.endDate,
          renderStartDate,
          totalDays,
          dayWidth
        );
        if (!geometry) return null;
        const isCurrent = sprint.startDate <= today && today <= sprint.endDate;

        return (
          <div
            key={sprint.startDate}
            className={styles.segment}
            style={{ left: geometry.left, width: geometry.width }}
            data-testid="capacity-segment"
            data-sprint-start={sprint.startDate}
            data-load={loadLevel(figure.load)}
            {...(isCurrent ? { 'data-current': 'true' } : {})}
          >
            <CapacityBadge figure={figure} showText={showText} />
          </div>
        );
      })}
    </div>
  );
}
