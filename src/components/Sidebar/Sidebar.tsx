import { useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { SIDEBAR_WIDTH, HEADER_HEIGHT } from '../../lib/layout';
import { MemberRow } from './MemberRow';
import { AddMemberForm } from './AddMemberForm';
import styles from './Sidebar.module.css';

export function Sidebar() {
  const members = useAppStore(s => s.members);
  const setSettingsOpen = useAppStore(s => s.setSettingsOpen);

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => a.sortOrder - b.sortOrder),
    [members]
  );

  const handleSettingsClick = useCallback(() => {
    setSettingsOpen(true);
  }, [setSettingsOpen]);

  return (
    <div className={styles.sidebar} style={{ width: SIDEBAR_WIDTH }}>
      <div className={styles.header} style={{ height: HEADER_HEIGHT }}>
        <span className={styles.title}>Team</span>
        <button className={styles.gearBtn} onClick={handleSettingsClick} title="Sprint settings">
          &#9881;
        </button>
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
    </div>
  );
}
