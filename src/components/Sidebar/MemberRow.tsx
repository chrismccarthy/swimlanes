import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Member } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { useDialog } from '../../store/useDialogStore';
import { useDragMember } from '../../hooks/useDragMember';
import { useMemberCurrentLoad } from '../../hooks/useCapacity';
import { formatLoadPercent, loadLevel } from '../../lib/capacity';
import { assignTracks, computeRowHeight, CAPACITY_STRIP_HEIGHT } from '../../lib/layout';
import styles from './Sidebar.module.css';

interface MemberRowProps {
  member: Member;
}

export function MemberRow({ member }: MemberRowProps) {
  const renameMember = useAppStore(s => s.renameMember);
  const removeMember = useAppStore(s => s.removeMember);
  const blocks = useAppStore(s => s.blocks);
  const { confirm } = useDialog();
  const capacityEnabled = useAppStore(s => s.capacityEnabled);

  const { onPointerDown: onDragPointerDown } = useDragMember(member.id);

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
  // Must track SwimLane exactly, including the band the capacity strip takes.
  const currentLoad = useMemberCurrentLoad(member.id);
  const rowHeight = computeRowHeight(trackCount, capacityEnabled ? CAPACITY_STRIP_HEIGHT : 0);

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
    void confirm({
      title: 'Remove member?',
      message: msg,
      confirmLabel: 'Remove',
      danger: true,
    }).then(ok => {
      if (ok) removeMember(member.id);
    });
  }, [member.id, member.name, memberBlocks.length, removeMember, confirm]);

  return (
    <div className={styles.memberRow} style={{ height: rowHeight }} data-testid="member-row" data-member-id={member.id}>
      <span
        className={styles.dragHandle}
        onPointerDown={onDragPointerDown}
        title="Drag to reorder"
      >
        &#8942;&#8942;
      </span>
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
      {currentLoad && (
        <span
          className={`${styles.memberLoad} ${styles[loadLevel(currentLoad.load)]}`}
          data-testid="member-load"
          data-load={loadLevel(currentLoad.load)}
          title={`${currentLoad.committedDays} / ${currentLoad.availableDays} d committed this sprint`}
        >
          {formatLoadPercent(currentLoad.load)}
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
