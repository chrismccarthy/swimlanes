import { useAppStore } from '../../store/useAppStore';
import { useContextMenuDismiss } from '../../hooks/useContextMenu';
import styles from './ContextMenu.module.css';

export function ContextMenu() {
  const contextMenu = useAppStore(s => s.contextMenu);
  const openEditModal = useAppStore(s => s.openEditModal);
  const duplicateBlock = useAppStore(s => s.duplicateBlock);
  const deleteBlock = useAppStore(s => s.deleteBlock);
  const setContextMenu = useAppStore(s => s.setContextMenu);

  useContextMenuDismiss();

  if (!contextMenu) return null;

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    openEditModal(contextMenu.blockId);
  };

  const handleDuplicate = (e: React.MouseEvent) => {
    e.stopPropagation();
    duplicateBlock(contextMenu.blockId);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteBlock(contextMenu.blockId);
  };

  return (
    <div
      className={styles.menu}
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onClick={e => e.stopPropagation()}
    >
      <button className={styles.item} onClick={handleEdit}>
        Edit
      </button>
      <button className={styles.item} onClick={handleDuplicate}>
        Duplicate
      </button>
      <div className={styles.divider} />
      <button className={`${styles.item} ${styles.danger}`} onClick={handleDelete}>
        Delete
      </button>
    </div>
  );
}
