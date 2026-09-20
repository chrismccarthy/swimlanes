/**
 * Block tags: a handful of free-text labels per block.
 *
 * The rules here are the client-side half of the database constraints added in
 * `supabase/migrations/009_block_tags.sql` (`blocks_tags_count`,
 * `blocks_tags_valid`): at most ten tags, each non-blank once trimmed, at most
 * 30 characters and free of commas. Case is kept exactly as typed — "Infra" and
 * "infra" read differently to a human — but two tags that differ only in case
 * are the same tag for de-duplication, suggestions and filtering.
 */

/** Maximum number of tags on one block — mirrors `blocks_tags_count`. */
export const MAX_TAGS = 10;

/** Maximum length of one tag, after trimming — mirrors `blocks_tags_valid`. */
export const MAX_TAG_LENGTH = 30;

/** Two tags are the same tag when they differ only in case or surrounding space. */
export function tagsMatch(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

/** The key a tag is compared and de-duplicated by. */
function tagKey(tag: string): string {
  return tag.trim().toLocaleLowerCase();
}

/**
 * Clean an untrusted value into a storable tag list.
 *
 * Anything that is not an array of strings collapses to `[]`. Each string is
 * split on commas (a comma can never be part of a tag, so a pasted
 * "infra, api" becomes two tags), trimmed, truncated to `MAX_TAG_LENGTH`, and
 * dropped when it is left empty. Case-insensitive duplicates are removed
 * keeping the first spelling, and the result is capped at `MAX_TAGS`.
 */
export function normaliseTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    for (const part of raw.split(',')) {
      // Truncate, then trim again so a cut mid-word cannot leave a trailing space.
      const tag = part.trim().slice(0, MAX_TAG_LENGTH).trim();
      if (!tag) continue;
      const key = tagKey(tag);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
      if (out.length >= MAX_TAGS) return out;
    }
  }
  return out;
}

/**
 * Does this block pass the current filter? An empty filter matches everything;
 * otherwise any one of the active tags is enough (OR semantics).
 */
export function matchesActiveTags(tags: string[], activeTags: string[]): boolean {
  if (activeTags.length === 0) return true;
  return tags.some(tag => activeTags.some(active => tagsMatch(tag, active)));
}

/**
 * Every distinct tag used on a board, sorted for a stable filter bar. Tags that
 * differ only in case are folded together, keeping the first spelling seen.
 */
export function distinctTags(blocks: { tags: string[] }[]): string[] {
  const bySpelling = new Map<string, string>();
  for (const block of blocks) {
    for (const tag of block.tags) {
      const key = tagKey(tag);
      if (!key || bySpelling.has(key)) continue;
      bySpelling.set(key, tag.trim());
    }
  }
  return [...bySpelling.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
}
