import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store/useAppStore';
import styles from './ShortcutsModal.module.css';

/** Cmd on a Mac, Ctrl everywhere else — the handler accepts either. */
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
  ? '⌘'
  : 'Ctrl';

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: 'Tab', description: 'Move between blocks' },
  { keys: 'Esc', description: 'Deselect' },
  { keys: '← / →', description: 'Move block one day' },
  { keys: 'Shift + → / ←', description: 'Extend / shrink the end date' },
  { keys: 'Alt + ← / →', description: 'Move the start date only' },
  { keys: '↑ / ↓', description: 'Move block to the previous / next lane' },
  { keys: 'Enter', description: 'Edit block' },
  { keys: 'Delete', description: 'Delete block' },
  { keys: `${MOD} + D`, description: 'Duplicate block' },
  { keys: `${MOD} + Z`, description: 'Undo' },
  { keys: `${MOD} + Shift + Z`, description: 'Redo' },
  { keys: '?', description: 'This list' },
];

export function ShortcutsModal() {
  const isShortcutsOpen = useAppStore(s => s.isShortcutsOpen);
  const setShortcutsOpen = useAppStore(s => s.setShortcutsOpen);

  const handleClose = useCallback(() => setShortcutsOpen(false), [setShortcutsOpen]);

  if (!isShortcutsOpen) return null;

  return createPortal(
    <div className={styles.overlay} onClick={handleClose}>
      <div
        className={styles.modal}
        data-testid="shortcuts-modal"
        onClick={e => e.stopPropagation()}
      >
        <h2 className={styles.heading}>Keyboard shortcuts</h2>
        <dl className={styles.list}>
          {SHORTCUTS.map(shortcut => (
            <div className={styles.row} key={shortcut.keys}>
              <dt className={styles.keys}>{shortcut.keys}</dt>
              <dd className={styles.description}>{shortcut.description}</dd>
            </div>
          ))}
        </dl>
        <div className={styles.actions}>
          <button className={styles.closeBtn} onClick={handleClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
