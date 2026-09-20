import { useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store/useAppStore';
import type { BlockColor } from '../../types';
import { daysBetween } from '../../lib/dates';
import { distinctTags } from '../../lib/tags';
import { ColorPicker } from './ColorPicker';
import { TagInput } from './TagInput';
import styles from './BlockModal.module.css';

function BlockModalInner({ blockId }: { blockId: string }) {
  const newBlockId = useAppStore(s => s.newBlockId);
  const draftBlock = useAppStore(s => s.draftBlock);
  const blocks = useAppStore(s => s.blocks);
  const addBlock = useAppStore(s => s.addBlock);
  const updateBlock = useAppStore(s => s.updateBlock);
  const closeModal = useAppStore(s => s.closeModal);

  const block = blockId === newBlockId && draftBlock
    ? draftBlock
    : blocks.find(b => b.id === blockId);

  // Key-based remount (via parent) resets these to block values
  const [title, setTitle] = useState(block?.title ?? '');
  const [startDate, setStartDate] = useState(block?.startDate ?? '');
  const [endDate, setEndDate] = useState(block?.endDate ?? '');
  const [color, setColor] = useState<BlockColor>(block?.color ?? 'blue');
  const [tags, setTags] = useState<string[]>(block?.tags ?? []);

  // Completions come from the rest of the board, so a team converges on one
  // spelling of a tag instead of inventing a new one on every block.
  const suggestions = useMemo(() => distinctTags(blocks), [blocks]);

  const handleCancel = useCallback(() => {
    // Draft block was never inserted into DB, so just close — no cleanup needed
    closeModal();
  }, [closeModal]);

  const handleSave = useCallback(() => {
    if (!blockId || !block || !title.trim()) return;
    if (daysBetween(startDate, endDate) < 0) return;
    if (blockId === newBlockId) {
      // New block — insert into DB for the first time
      addBlock({ ...block, title: title.trim(), startDate, endDate, color, tags });
    } else {
      updateBlock(blockId, { title: title.trim(), startDate, endDate, color, tags });
    }
    closeModal();
  }, [blockId, newBlockId, block, title, startDate, endDate, color, tags, addBlock, updateBlock, closeModal]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') handleCancel();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
  }, [handleCancel, handleSave]);

  if (!block) return null;

  const hasDateError = daysBetween(startDate, endDate) < 0;
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

        <TagInput tags={tags} onChange={setTags} suggestions={suggestions} />

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

export function BlockModal() {
  const isModalOpen = useAppStore(s => s.isModalOpen);
  const editingBlockId = useAppStore(s => s.editingBlockId);

  if (!isModalOpen || !editingBlockId) return null;

  // key={editingBlockId} remounts BlockModalInner, resetting useState to fresh block values
  return <BlockModalInner key={editingBlockId} blockId={editingBlockId} />;
}
