import { isoToday } from '../../lib/dates';
import { dateToX } from '../../lib/layout';
import styles from './TodayMarker.module.css';

interface TodayMarkerProps {
  renderStartDate: string;
  totalHeight: number;
  dayWidth: number;
}

export function TodayMarker({ renderStartDate, totalHeight, dayWidth }: TodayMarkerProps) {
  const today = isoToday();
  const left = dateToX(today, renderStartDate, dayWidth) + dayWidth / 2;

  return (
    <div
      className={styles.marker}
      style={{ left, height: totalHeight }}
    >
      <div className={styles.label}>Today</div>
    </div>
  );
}
