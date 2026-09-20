import { useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import styles from './Sidebar.module.css';

/**
 * Turns the capacity view on and off: committed vs available days per sprint,
 * in the header band, in every lane, and beside every member.
 */
export function CapacityToggle() {
  const capacityEnabled = useAppStore(s => s.capacityEnabled);
  const setCapacityEnabled = useAppStore(s => s.setCapacityEnabled);

  const handleClick = useCallback(() => {
    setCapacityEnabled(!capacityEnabled);
  }, [capacityEnabled, setCapacityEnabled]);

  return (
    <button
      type="button"
      className={`${styles.capacityBtn} ${capacityEnabled ? styles.capacityBtnActive : ''}`}
      aria-pressed={capacityEnabled}
      title={
        capacityEnabled
          ? 'Hide committed vs available days per sprint'
          : 'Show committed vs available days per sprint'
      }
      onClick={handleClick}
    >
      <span className={styles.capacityMark} aria-hidden="true">
        {capacityEnabled ? '☑' : '☐'}
      </span>
      Capacity
    </button>
  );
}
