import { useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { ZoomLevel } from '../../types';
import styles from './Sidebar.module.css';

const OPTIONS: { value: ZoomLevel; label: string; title: string }[] = [
  { value: 'day', label: 'Day', title: 'Day zoom — one column per day' },
  { value: 'week', label: 'Week', title: 'Week zoom — one column per week' },
  { value: 'quarter', label: 'Quarter', title: 'Quarter zoom — a full quarter on screen' },
];

export function ZoomControl() {
  const zoom = useAppStore(s => s.zoom);
  const setZoom = useAppStore(s => s.setZoom);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      setZoom(e.currentTarget.value as ZoomLevel);
    },
    [setZoom]
  );

  return (
    <div className={styles.zoomControl} role="group" aria-label="Timeline zoom">
      {OPTIONS.map(option => (
        <button
          key={option.value}
          type="button"
          value={option.value}
          className={`${styles.zoomBtn} ${zoom === option.value ? styles.zoomBtnActive : ''}`}
          aria-pressed={zoom === option.value}
          title={option.title}
          onClick={handleClick}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
