import { useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useDialog } from '../../store/useDialogStore';
import styles from './Sidebar.module.css';

/**
 * The sidebar header's board picker.
 *
 * Two entries below the boards act as commands rather than destinations, so
 * the select snaps straight back to the current board after either is chosen.
 */
const NEW_BOARD = '__new__';
const BOARD_SETTINGS = '__settings__';

export function BoardSwitcher() {
  const boards = useAppStore(s => s.boards);
  const currentBoardId = useAppStore(s => s.currentBoardId);
  const setCurrentBoard = useAppStore(s => s.setCurrentBoard);
  const createBoard = useAppStore(s => s.createBoard);
  const setBoardSettingsOpen = useAppStore(s => s.setBoardSettingsOpen);
  const { prompt } = useDialog();

  const current = boards.find(b => b.id === currentBoardId);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    // Reset first: neither command changes which board is selected.
    e.target.value = currentBoardId ?? '';

    if (value === NEW_BOARD) {
      void prompt({
        title: 'New board',
        label: 'Board name',
        confirmLabel: 'Create',
        validate: name => (name.trim() ? undefined : 'Board name is required'),
      }).then(name => {
        if (name) createBoard(name);
      });
      return;
    }
    if (value === BOARD_SETTINGS) {
      setBoardSettingsOpen(true);
      return;
    }
    setCurrentBoard(value);
  }, [currentBoardId, createBoard, setBoardSettingsOpen, setCurrentBoard, prompt]);

  return (
    <select
      className={styles.boardSwitcher}
      aria-label="Board"
      title={current ? `Board: ${current.name}` : 'Board'}
      data-testid="board-switcher"
      value={currentBoardId ?? ''}
      onChange={handleChange}
    >
      {boards.map(board => (
        <option key={board.id} value={board.id}>{board.name}</option>
      ))}
      <option value={NEW_BOARD}>New board&hellip;</option>
      {/* Owners manage the board here; editors get the same panel read-only. */}
      {current && <option value={BOARD_SETTINGS}>Board settings&hellip;</option>}
    </select>
  );
}
