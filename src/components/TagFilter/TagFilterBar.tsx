import { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { distinctTags, matchesActiveTags, tagsMatch } from '../../lib/tags';
import styles from './TagFilterBar.module.css';

/**
 * A thin strip above the board listing every tag in use, as toggle chips.
 *
 * Selecting several tags widens the selection (OR), because "show me infra or
 * api" is what people mean when they pick two. Blocks that fall outside it are
 * dimmed rather than hidden (see Block.tsx), so lanes keep their layout and you
 * can still see where the filtered-out work sits.
 *
 * The bar is absent until the board has at least one tag — an empty filter row
 * above every board would cost 36px of timeline for nothing.
 */
export function TagFilterBar() {
  const blocks = useAppStore(s => s.blocks);
  const activeTags = useAppStore(s => s.activeTags);
  const toggleTag = useAppStore(s => s.toggleTag);
  const clearTags = useAppStore(s => s.clearTags);

  const tags = useMemo(() => distinctTags(blocks), [blocks]);
  const matching = useMemo(
    () => blocks.filter(b => matchesActiveTags(b.tags, activeTags)).length,
    [blocks, activeTags],
  );

  if (tags.length === 0) return null;

  return (
    <div className={styles.bar} data-testid="tag-filter-bar" data-print="hide">
      <span className={styles.caption}>Tags</span>
      <div className={styles.chips} role="group" aria-label="Filter blocks by tag">
        {tags.map(tag => {
          const isActive = activeTags.some(t => tagsMatch(t, tag));
          return (
            <button
              key={tag}
              type="button"
              className={`${styles.chip} ${isActive ? styles.chipActive : ''}`}
              aria-pressed={isActive}
              data-testid="tag-filter-chip"
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          );
        })}
      </div>
      {activeTags.length > 0 && (
        <button type="button" className={styles.clear} onClick={clearTags}>
          Clear
        </button>
      )}
      <span className={styles.count} data-testid="tag-filter-count">
        {matching} of {blocks.length} blocks
      </span>
    </div>
  );
}
