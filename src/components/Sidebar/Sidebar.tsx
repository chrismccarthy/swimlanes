import { useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { SIDEBAR_WIDTH, HEADER_HEIGHT } from '../../lib/layout';
import { BoardSwitcher } from './BoardSwitcher';
import { MemberRow } from './MemberRow';
import { AddMemberForm } from './AddMemberForm';
import { ZoomControl } from './ZoomControl';
import { SyncStatusPill } from './SyncStatusPill';
import { CapacityToggle } from './CapacityToggle';
import { ExportMenu } from '../Export/ExportMenu';
import styles from './Sidebar.module.css';

export function Sidebar() {
  const members = useAppStore(s => s.members);
  const setSettingsOpen = useAppStore(s => s.setSettingsOpen);
  const setShortcutsOpen = useAppStore(s => s.setShortcutsOpen);

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => a.sortOrder - b.sortOrder),
    [members]
  );

  const handleSettingsClick = useCallback(() => {
    setSettingsOpen(true);
  }, [setSettingsOpen]);

  const handleShortcutsClick = useCallback(() => {
    setShortcutsOpen(true);
  }, [setShortcutsOpen]);

  return (
    <div className={styles.sidebar} style={{ width: SIDEBAR_WIDTH }}>
      <div className={styles.header} style={{ height: HEADER_HEIGHT }}>
        <div className={styles.headerTop}>
          <BoardSwitcher />
          <ExportMenu />
          <button className={styles.gearBtn} onClick={handleSettingsClick} title="Sprint settings">
            &#9881;
          </button>
          <button
            className={styles.gearBtn}
            onClick={handleShortcutsClick}
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
          >
            ?
          </button>
        </div>
        <div className={styles.headerBottom}>
          <ZoomControl />
        </div>
      </div>
      <div className={styles.memberList}>
        {sortedMembers.map(member => (
          <MemberRow key={member.id} member={member} />
        ))}
        {sortedMembers.length === 0 && (
          <div className={styles.empty}>No team members yet</div>
        )}
      </div>
      <AddMemberForm />
      <div className={styles.footer} data-print="hide">
        <SyncStatusPill />
        <CapacityToggle />
      </div>
    </div>
  );
}
