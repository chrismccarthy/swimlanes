import { useCallback, useId, useState } from 'react';
import { MAX_TAGS, normaliseTags, tagsMatch } from '../../lib/tags';
import styles from './TagInput.module.css';

interface TagInputProps {
  /** The tags currently on the block being edited. */
  tags: string[];
  onChange: (tags: string[]) => void;
  /** Tags already used elsewhere on this board, offered as completions. */
  suggestions: string[];
}

/**
 * Chip-per-tag editor: type a tag and press Enter (or type a comma) to add it,
 * click the × on a chip — or press Backspace in an empty input — to take one
 * off. Everything is reachable from the keyboard alone; the browser's native
 * datalist supplies completions from the rest of the board.
 */
export function TagInput({ tags, onChange, suggestions }: TagInputProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const listId = useId();
  const isFull = tags.length >= MAX_TAGS;

  // Only offer tags this block does not already carry.
  const available = suggestions.filter(s => !tags.some(t => tagsMatch(t, s)));

  const commit = useCallback((raw: string) => {
    // normaliseTags does the trimming, comma-splitting and length capping, so
    // a pasted "infra, api" adds both tags in one go.
    const candidates = normaliseTags([raw]);
    if (candidates.length === 0) {
      setDraft('');
      return;
    }
    const next = [...tags];
    let rejected: string | null = null;
    for (const tag of candidates) {
      if (next.some(t => tagsMatch(t, tag))) {
        rejected = `"${tag}" is already on this block`;
        continue;
      }
      if (next.length >= MAX_TAGS) {
        rejected = `A block can have at most ${MAX_TAGS} tags`;
        break;
      }
      next.push(tag);
    }
    setDraft('');
    setError(rejected);
    if (next.length !== tags.length) onChange(next);
  }, [tags, onChange]);

  const removeTag = useCallback((tag: string) => {
    setError(null);
    onChange(tags.filter(t => t !== tag));
  }, [tags, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === ',') {
      // Enter here means "add this tag", not "save the block" — but Cmd/Ctrl+Enter
      // is the modal's save shortcut and is left to bubble.
      e.preventDefault();
      e.stopPropagation();
      commit(draft);
      return;
    }
    if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      e.preventDefault();
      removeTag(tags[tags.length - 1]);
    }
  }, [commit, draft, removeTag, tags]);

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>Tags</label>
      <div className={styles.chips} data-testid="tag-input">
        {tags.map(tag => (
          <span key={tag} className={styles.chip} data-testid="tag-chip">
            {tag}
            <button
              type="button"
              className={styles.remove}
              aria-label={`Remove tag ${tag}`}
              onClick={() => removeTag(tag)}
            >
              &times;
            </button>
          </span>
        ))}
        <input
          id={inputId}
          list={available.length > 0 ? listId : undefined}
          type="text"
          className={styles.input}
          value={draft}
          // Still focusable when full: Backspace has to be able to take one off.
          placeholder={isFull ? `${MAX_TAGS} tags is the limit` : 'Add a tag…'}
          autoComplete="off"
          onChange={e => {
            const value = e.target.value;
            // A comma is a separator, never part of a tag — including when one
            // arrives by paste or by picking a suggestion.
            if (value.includes(',')) commit(value);
            else {
              setDraft(value);
              setError(null);
            }
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => commit(draft)}
        />
      </div>
      <datalist id={listId}>
        {available.map(s => <option key={s} value={s} />)}
      </datalist>
      {error && <span className={styles.error} role="alert">{error}</span>}
    </div>
  );
}
