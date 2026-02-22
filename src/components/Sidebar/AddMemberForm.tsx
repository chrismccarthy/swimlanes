import { useState, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import styles from './Sidebar.module.css';

export function AddMemberForm() {
  const addMember = useAppStore(s => s.addMember);
  const [name, setName] = useState('');

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    addMember(trimmed);
    setName('');
  }, [name, addMember]);

  return (
    <form className={styles.addForm} onSubmit={handleSubmit}>
      <input
        type="text"
        className={styles.addInput}
        placeholder="Add member..."
        value={name}
        onChange={e => setName(e.target.value)}
      />
      <button type="submit" className={styles.addButton} disabled={!name.trim()}>
        +
      </button>
    </form>
  );
}
