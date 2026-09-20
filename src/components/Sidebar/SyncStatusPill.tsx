import { useAppStore } from '../../store/useAppStore';
import type { SyncStatus } from '../../store/useAppStore';
import styles from './Sidebar.module.css';

const LABEL: Record<SyncStatus, string> = {
  live: 'Live',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
};

const TITLE: Record<SyncStatus, string> = {
  live: 'Connected — changes from your team appear as they happen',
  reconnecting: 'Connection lost — retrying; this board may be out of date',
  offline: 'No network — changes are paused until you are back online',
};

/**
 * The sidebar's quiet connection light.
 *
 * Healthy is the normal case and says so in passing; the two states that mean
 * "what you are looking at may be stale" are the ones that carry colour.
 */
export function SyncStatusPill() {
  const status = useAppStore(s => s.syncStatus);

  return (
    <div
      className={`${styles.syncPill} ${styles[`sync_${status}`]}`}
      data-testid="sync-status"
      data-status={status}
      title={TITLE[status]}
      data-print="hide"
    >
      <span className={styles.syncDot} aria-hidden="true" />
      <span>{LABEL[status]}</span>
    </div>
  );
}
