import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store/useAppStore';
import type { BlockColor } from '../../types';
import { ColorPicker } from './ColorPicker';
import styles from './BlockModal.module.css';

export function BlockModal() {
  const isModalOpen = useAppStore(s => s.isModalOpen);
  const editingBlockId = useAppStore(s => s.editingBlockId);
  const newBlockId = useAppStore(s => s.newBlockId);
  const blocks = useAppStore(s => s.blocks);
  const updateBlock = useAppStore(s => s.updateBlock);
  const deleteBlock = useAppStore(s => s.deleteBlock);
  const closeModal = useAppStore(s => s.closeModal);

  const block = blocks.find(b => b.id === editingBlockId);

  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [color, setColor] = useState<BlockColor>('blue');

  useEffect(() => {
    if (block) {
      setTitle(block.title);
      setStartDate(block.startDate);
      setEndDate(block.endDate);
      setColor(block.color);
    }
  }, [block]);

  const handleCancel = useCallback(() => {
    // If this was a freshly created block (via double-click) that was never saved,
    // delete it so it doesn't orphan on the timeline
    if (editingBlockId && editingBlockId === newBlockId) {
      deleteBlock(editingBlockId);
    }
    closeModal();
  }, [editingBlockId, newBlockId, deleteBlock, closeModal]);

  const handleSave = useCallback(() => {
    if (!editingBlockId || !title.trim()) return;
    if (startDate > endDate) return;
    updateBlock(editingBlockId, {
      title: title.trim(),
      startDate,
      endDate,
      color,
    });
    closeModal();
  }, [editingBlockId, title, startDate, endDate, color, updateBlock, closeModal]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') handleCancel();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
  }, [handleCancel, handleSave]);

  if (!isModalOpen || !block) return null;

  const hasDateError = startDate > endDate;
  const hasTitleError = !title.trim();
  const isValid = !hasDateError && !hasTitleError;

  return createPortal(
    <div className={styles.overlay} onClick={handleCancel} onKeyDown={handleKeyDown}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <h2 className={styles.heading}>Edit Block</h2>

        <label className={styles.label}>
          Title
          <input
            type="text"
            className={`${styles.input} ${hasTitleError && title !== block.title ? styles.inputError : ''}`}
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
          />
        </label>

        <div className={styles.dateRow}>
          <label className={styles.label}>
            Start Date
            <input
              type="date"
              className={`${styles.input} ${hasDateError ? styles.inputError : ''}`}
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
          </label>
          <label className={styles.label}>
            End Date
            <input
              type="date"
              className={`${styles.input} ${hasDateError ? styles.inputError : ''}`}
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </label>
        </div>
        {hasDateError && (
          <span className={styles.errorText}>End date must be on or after start date</span>
        )}

        <label className={styles.label}>
          Color
          <ColorPicker value={color} onChange={setColor} />
        </label>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={handleCancel}>
            Cancel
          </button>
          <button className={styles.saveBtn} onClick={handleSave} disabled={!isValid}>
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
