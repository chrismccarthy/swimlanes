import type { CapacityFigure } from '../../lib/capacity';
import { formatCapacityDays, loadLevel } from '../../lib/capacity';
import styles from './Capacity.module.css';

interface CapacityBadgeProps {
  figure: CapacityFigure;
  /** Dropped at quarter zoom, where a sprint is too narrow for the numbers. */
  showText?: boolean;
  testId?: string;
}

/**
 * "7 / 10 d" and a thin bar, coloured by how loaded the sprint is.
 * The bar fills proportionally and saturates at 100% — the `over` colour,
 * not a longer bar, is what says a load has run past capacity.
 */
export function CapacityBadge({ figure, showText = true, testId }: CapacityBadgeProps) {
  const level = loadLevel(figure.load);
  const fillPercent = Math.min(1, Math.max(0, figure.load)) * 100;

  return (
    <span
      className={styles.badge}
      data-testid={testId}
      data-load={level}
      title={`${formatCapacityDays(figure)} committed`}
    >
      {showText && (
        <span className={`${styles.text} ${styles[level]}`}>{formatCapacityDays(figure)}</span>
      )}
      <span className={styles.track}>
        <span
          className={`${styles.fill} ${styles[level]}`}
          data-load={level}
          style={{ width: `${fillPercent}%` }}
        />
      </span>
    </span>
  );
}
