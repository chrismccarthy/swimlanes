import { useAppStore } from '../../store/useAppStore';
import styles from './OfflineBanner.module.css';

export function OfflineBanner() {
  const isOnline = useAppStore(s => s.isOnline);

  if (isOnline) return null;

  return (
    <div className={styles.banner} data-print="hide">
      You're offline — changes are paused. Reconnecting...
    </div>
  );
}
