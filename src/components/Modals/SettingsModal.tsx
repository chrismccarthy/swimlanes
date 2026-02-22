import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store/useAppStore';
import styles from './SettingsModal.module.css';

export function SettingsModal() {
  const isSettingsOpen = useAppStore(s => s.isSettingsOpen);
  const sprintAnchorDate = useAppStore(s => s.sprintAnchorDate);
  const sprintLengthDays = useAppStore(s => s.sprintLengthDays);
  const updateSprintSettings = useAppStore(s => s.updateSprintSettings);
  const setSettingsOpen = useAppStore(s => s.setSettingsOpen);

  const [anchor, setAnchor] = useState('');
  const [length, setLength] = useState('');

  useEffect(() => {
    if (isSettingsOpen) {
      setAnchor(sprintAnchorDate);
      setLength(String(sprintLengthDays));
    }
  }, [isSettingsOpen, sprintAnchorDate, sprintLengthDays]);

  const handleSave = useCallback(() => {
    const len = parseInt(length, 10);
    if (!anchor || isNaN(len) || len < 1) return;
    updateSprintSettings(anchor, len);
    setSettingsOpen(false);
  }, [anchor, length, updateSprintSettings, setSettingsOpen]);

  const handleClose = useCallback(() => {
    setSettingsOpen(false);
  }, [setSettingsOpen]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') handleClose();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
  }, [handleClose, handleSave]);

  if (!isSettingsOpen) return null;

  return createPortal(
    <div className={styles.overlay} onClick={handleClose} onKeyDown={handleKeyDown}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <h2 className={styles.heading}>Sprint Settings</h2>

        <label className={styles.label}>
          Sprint Anchor Date
          <span className={styles.hint}>A known sprint start date (Thursday)</span>
          <input
            type="date"
            className={styles.input}
            value={anchor}
            onChange={e => setAnchor(e.target.value)}
            autoFocus
          />
        </label>

        <label className={styles.label}>
          Sprint Length (days)
          <input
            type="number"
            className={styles.input}
            value={length}
            onChange={e => setLength(e.target.value)}
            min={1}
            max={42}
          />
        </label>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={handleClose}>
            Cancel
          </button>
          <button className={styles.saveBtn} onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
