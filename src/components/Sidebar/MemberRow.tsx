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
  const moveMemberUp = useAppStore(s => s.moveMemberUp);
  const moveMemberDown = useAppStore(s => s.moveMemberDown);
  const members = useAppStore(s => s.members);
  const blocks = useAppStore(s => s.blocks);

  const sortedMembers = [...members].sort((a, b) => a.order - b.order);
  const memberIndex = sortedMembers.findIndex(m => m.id === member.id);
  const isFirst = memberIndex === 0;
  const isLast = memberIndex === sortedMembers.length - 1;

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
    const blockCount = memberBlocks.length;
    const msg = blockCount > 0
      ? `Delete "${member.name}" and their ${blockCount} block${blockCount === 1 ? '' : 's'}?`
      : `Delete "${member.name}"?`;
    if (window.confirm(msg)) {
      removeMember(member.id);
    }
  }, [member.id, member.name, memberBlocks.length, removeMember]);

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
        className={styles.reorderBtn}
        onClick={() => moveMemberUp(member.id)}
        disabled={isFirst}
        title="Move up"
      >
        &#8593;
      </button>
      <button
        className={styles.reorderBtn}
        onClick={() => moveMemberDown(member.id)}
        disabled={isLast}
        title="Move down"
      >
        &#8595;
      </button>
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
