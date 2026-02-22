import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store/useAppStore';
import type { BlockColor } from '../../types';
import { ColorPicker } from './ColorPicker';
import styles from './BlockModal.module.css';

export function BlockModal() {
  const isModalOpen = useAppStore(s => s.isModalOpen);
  const editingBlockId = useAppStore(s => s.editingBlockId);
  const blocks = useAppStore(s => s.blocks);
  const updateBlock = useAppStore(s => s.updateBlock);
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
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
  }, [closeModal, handleSave]);

  if (!isModalOpen || !block) return null;

  return createPortal(
    <div className={styles.overlay} onClick={closeModal} onKeyDown={handleKeyDown}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <h2 className={styles.heading}>Edit Block</h2>

        <label className={styles.label}>
          Title
          <input
            type="text"
            className={styles.input}
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
              className={styles.input}
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
          </label>
          <label className={styles.label}>
            End Date
            <input
              type="date"
              className={styles.input}
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </label>
        </div>

        <label className={styles.label}>
          Color
          <ColorPicker value={color} onChange={setColor} />
        </label>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={closeModal}>
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
