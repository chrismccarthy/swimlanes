import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store/useAppStore';
import { useDialog } from '../../store/useDialogStore';
import type { BoardMember, BoardRole } from '../../types';
import {
  listBoardMembers,
  addBoardMemberByEmail,
  removeBoardMember,
  supportsMemberManagement,
  memberManagementNote,
} from '../../lib/supabase/boards';
import styles from './BoardSettingsModal.module.css';

function BoardSettingsModalInner({ boardId }: { boardId: string }) {
  const boards = useAppStore(s => s.boards);
  const renameBoard = useAppStore(s => s.renameBoard);
  const deleteBoard = useAppStore(s => s.deleteBoard);
  const setBoardSettingsOpen = useAppStore(s => s.setBoardSettingsOpen);
  const addToast = useAppStore(s => s.addToast);
  const { confirm } = useDialog();

  const board = boards.find(b => b.id === boardId);
  const isOwner = board?.role === 'owner';
  // The only board you have is the one you would be left without.
  const isOnlyBoard = boards.length <= 1;

  const [name, setName] = useState(board?.name ?? '');
  const [members, setMembers] = useState<BoardMember[] | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<BoardRole>('editor');
  const [inviteError, setInviteError] = useState('');
  const [busy, setBusy] = useState(false);

  const reloadMembers = useCallback(() => {
    listBoardMembers(boardId)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [boardId]);

  useEffect(reloadMembers, [reloadMembers]);

  const handleClose = useCallback(() => {
    setBoardSettingsOpen(false);
  }, [setBoardSettingsOpen]);

  const handleSave = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed || !board) return;
    if (trimmed !== board.name) renameBoard(board.id, trimmed);
    setBoardSettingsOpen(false);
  }, [name, board, renameBoard, setBoardSettingsOpen]);

  const handleDelete = useCallback(() => {
    if (!board || isOnlyBoard) return;
    const boardId = board.id;
    const msg = `Delete "${board.name}" and everything on it? This cannot be undone.`;
    void confirm({
      title: 'Delete board?',
      message: msg,
      confirmLabel: 'Delete',
      danger: true,
    }).then(ok => {
      if (ok) deleteBoard(boardId);
    });
  }, [board, isOnlyBoard, deleteBoard, confirm]);

  const handleInvite = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    setInviteError('');
    setBusy(true);
    addBoardMemberByEmail(boardId, email, inviteRole)
      .then(() => {
        setInviteEmail('');
        reloadMembers();
      })
      .catch((error: unknown) => {
        setInviteError(error instanceof Error ? error.message : 'Could not add that person');
      })
      .finally(() => setBusy(false));
  }, [boardId, inviteEmail, inviteRole, reloadMembers]);

  const handleRemove = useCallback((member: BoardMember) => {
    void confirm({
      title: 'Remove person?',
      message: `Remove ${member.email} from this board?`,
      confirmLabel: 'Remove',
      danger: true,
    }).then(ok => {
      if (!ok) return;
      removeBoardMember(boardId, member.userId)
        .then(reloadMembers)
        .catch((error: unknown) => {
          addToast(error instanceof Error ? error.message : 'Could not remove that person', 'error');
        });
    });
  }, [boardId, reloadMembers, addToast, confirm]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') handleClose();
  }, [handleClose]);

  if (!board) return null;

  return createPortal(
    <div className={styles.overlay} onClick={handleClose} onKeyDown={handleKeyDown}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} data-testid="board-settings">
        <h2 className={styles.heading}>Board Settings</h2>

        <div className={styles.section}>
          <span className={styles.sectionTitle}>Name</span>
          <input
            type="text"
            className={styles.input}
            aria-label="Board name"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={!isOwner}
            autoFocus
          />
        </div>

        <div className={styles.section}>
          <span className={styles.sectionTitle}>People</span>
          {members === null ? (
            <p className={styles.empty}>Loading&hellip;</p>
          ) : members.length === 0 ? (
            <p className={styles.empty}>Nobody else has access yet.</p>
          ) : (
            <div className={styles.memberList}>
              {members.map(member => (
                <div key={member.userId} className={styles.memberRow} data-testid="board-member">
                  <span className={styles.email}>{member.email}</span>
                  <span className={styles.role}>{member.role}</span>
                  {isOwner && supportsMemberManagement && (
                    <button
                      className={styles.removeBtn}
                      onClick={() => handleRemove(member)}
                      title={`Remove ${member.email}`}
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!supportsMemberManagement ? (
            <p className={styles.note}>{memberManagementNote}</p>
          ) : isOwner ? (
            <form className={styles.row} onSubmit={handleInvite}>
              <input
                type="email"
                className={styles.input}
                placeholder="person@example.com"
                aria-label="Email address"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
              />
              <select
                className={styles.select}
                aria-label="Role"
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as BoardRole)}
              >
                <option value="editor">Editor</option>
                <option value="owner">Owner</option>
              </select>
              <button type="submit" className={styles.saveBtn} disabled={busy || !inviteEmail.trim()}>
                Add
              </button>
            </form>
          ) : (
            <p className={styles.note}>Only this board&rsquo;s owners can change who has access.</p>
          )}
          {inviteError && <span className={styles.error}>{inviteError}</span>}
        </div>

        <div className={styles.actions}>
          {isOwner && (
            <button
              className={styles.deleteBtn}
              onClick={handleDelete}
              disabled={isOnlyBoard}
              title={isOnlyBoard ? 'You cannot delete your only board' : 'Delete this board'}
            >
              Delete board
            </button>
          )}
          <button className={styles.cancelBtn} onClick={handleClose}>
            {isOwner ? 'Cancel' : 'Close'}
          </button>
          {isOwner && (
            <button className={styles.saveBtn} onClick={handleSave} disabled={!name.trim()}>
              Save
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function BoardSettingsModal() {
  const isOpen = useAppStore(s => s.isBoardSettingsOpen);
  const currentBoardId = useAppStore(s => s.currentBoardId);

  if (!isOpen || !currentBoardId) return null;

  // key remounts on reopen / board switch, resetting useState to fresh values
  return <BoardSettingsModalInner key={currentBoardId} boardId={currentBoardId} />;
}
