import { isoToday } from '../../lib/dates';
import { dateToX, DAY_WIDTH } from '../../lib/layout';
import styles from './TodayMarker.module.css';

interface TodayMarkerProps {
  renderStartDate: string;
  totalHeight: number;
}

export function TodayMarker({ renderStartDate, totalHeight }: TodayMarkerProps) {
  const today = isoToday();
  const left = dateToX(today, renderStartDate) + DAY_WIDTH / 2;

  return (
    <div
      className={styles.marker}
      style={{ left, height: totalHeight }}
    >
      <div className={styles.label}>Today</div>
    </div>
  );
}
