import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Member } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { assignTracks, computeRowHeight } from '../../lib/layout';
import styles from './Sidebar.module.css';

interface MemberRowProps {
  member: Member;
}

export function MemberRow({ member }: MemberRowProps) {
  const renameMember = useAppStore(s => s.renameMember);
  const removeMember = useAppStore(s => s.removeMember);
  const blocks = useAppStore(s => s.blocks);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(member.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Compute row height to match the swim lane
  const memberBlocks = useMemo(
    () => blocks.filter(b => b.memberId === member.id),
    [blocks, member.id]
  );
  const { trackCount } = useMemo(
    () => assignTracks(memberBlocks),
    [memberBlocks]
  );
  const rowHeight = computeRowHeight(trackCount);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = useCallback(() => {
    setEditName(member.name);
    setIsEditing(true);
  }, [member.name]);

  const handleConfirm = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== member.name) {
      renameMember(member.id, trimmed);
    }
    setIsEditing(false);
  }, [editName, member.id, member.name, renameMember]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm();
    if (e.key === 'Escape') setIsEditing(false);
  }, [handleConfirm]);

  const handleDelete = useCallback(() => {
    removeMember(member.id);
  }, [member.id, removeMember]);

  return (
    <div className={styles.memberRow} style={{ height: rowHeight }}>
      {isEditing ? (
        <input
          ref={inputRef}
          className={styles.editInput}
          value={editName}
          onChange={e => setEditName(e.target.value)}
          onBlur={handleConfirm}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <span className={styles.memberName} onDoubleClick={handleDoubleClick}>
          {member.name}
        </span>
      )}
      <button
        className={styles.deleteBtn}
        onClick={handleDelete}
        title="Remove member"
      >
        &times;
      </button>
    </div>
  );
}
