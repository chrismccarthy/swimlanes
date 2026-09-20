import { useCallback, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { ToastContainer } from '../Toast/ToastContainer';
import styles from './FirstBoardScreen.module.css';

/**
 * Shown when a signed-in user belongs to no board yet. A timeline with no
 * board behind it would have nowhere to save anything, so this asks for a
 * name first and creates the board they will own.
 */
export function FirstBoardScreen() {
  const createBoard = useAppStore(s => s.createBoard);
  const [name, setName] = useState('');

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createBoard(trimmed);
    setName('');
  }, [name, createBoard]);

  return (
    <div className={styles.screen} data-testid="first-board-screen">
      <div className={styles.card}>
        <h1 className={styles.heading}>Create your first board</h1>
        <p className={styles.hint}>
          A board is one team&rsquo;s timeline: its own members, blocks and sprint
          settings. You can create more later, and invite people to each one.
        </p>
        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            type="text"
            className={styles.input}
            placeholder="Board name"
            aria-label="Board name"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
          <button type="submit" className={styles.createBtn} disabled={!name.trim()}>
            Create
          </button>
        </form>
      </div>
      <ToastContainer />
    </div>
  );
}
