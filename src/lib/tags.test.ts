import { describe, it, expect } from 'vitest';
import {
  MAX_TAGS,
  MAX_TAG_LENGTH,
  distinctTags,
  matchesActiveTags,
  normaliseTags,
  tagsMatch,
} from './tags';

describe('tagsMatch', () => {
  it('ignores case and surrounding whitespace', () => {
    expect(tagsMatch('infra', 'infra')).toBe(true);
    expect(tagsMatch('Infra', 'infra')).toBe(true);
    expect(tagsMatch('  INFRA ', 'infra')).toBe(true);
  });

  it('does not match different tags', () => {
    expect(tagsMatch('infra', 'api')).toBe(false);
    expect(tagsMatch('infra', 'infrastructure')).toBe(false);
    // Inner whitespace is part of the tag.
    expect(tagsMatch('data eng', 'dataeng')).toBe(false);
  });
});

describe('normaliseTags', () => {
  it('trims and drops blank entries', () => {
    expect(normaliseTags(['  infra ', '   ', 'api', ''])).toEqual(['infra', 'api']);
  });

  it('keeps the case it was given', () => {
    expect(normaliseTags(['Infra', 'API'])).toEqual(['Infra', 'API']);
  });

  it('folds case-insensitive duplicates, keeping the first spelling', () => {
    expect(normaliseTags(['Infra', 'infra', 'INFRA'])).toEqual(['Infra']);
  });

  it('splits on commas, because a tag can never contain one', () => {
    expect(normaliseTags(['infra, api', 'ops'])).toEqual(['infra', 'api', 'ops']);
    expect(normaliseTags([',,,'])).toEqual([]);
  });

  it(`caps a tag at ${MAX_TAG_LENGTH} characters, with no trailing space left behind`, () => {
    const long = `${'x'.repeat(MAX_TAG_LENGTH - 1)} yz`;
    expect(normaliseTags([long])).toEqual(['x'.repeat(MAX_TAG_LENGTH - 1)]);
    expect(normaliseTags(['y'.repeat(MAX_TAG_LENGTH + 5)])).toEqual(['y'.repeat(MAX_TAG_LENGTH)]);
  });

  it(`caps the list at ${MAX_TAGS} tags`, () => {
    const many = Array.from({ length: MAX_TAGS + 4 }, (_, i) => `tag-${i}`);
    expect(normaliseTags(many)).toHaveLength(MAX_TAGS);
    expect(normaliseTags(many)[MAX_TAGS - 1]).toBe(`tag-${MAX_TAGS - 1}`);
  });

  it('collapses anything that is not a list of strings', () => {
    expect(normaliseTags(undefined)).toEqual([]);
    expect(normaliseTags(null)).toEqual([]);
    expect(normaliseTags('infra')).toEqual([]);
    expect(normaliseTags({ 0: 'infra' })).toEqual([]);
    expect(normaliseTags([1, true, null, { a: 1 }, 'infra'])).toEqual(['infra']);
  });
});

describe('matchesActiveTags', () => {
  it('matches everything when no filter is active', () => {
    expect(matchesActiveTags([], [])).toBe(true);
    expect(matchesActiveTags(['infra'], [])).toBe(true);
  });

  it('is OR across the active tags', () => {
    expect(matchesActiveTags(['infra'], ['infra', 'api'])).toBe(true);
    expect(matchesActiveTags(['api', 'ops'], ['infra', 'api'])).toBe(true);
    expect(matchesActiveTags(['ops'], ['infra', 'api'])).toBe(false);
    expect(matchesActiveTags([], ['infra'])).toBe(false);
  });

  it('compares case-insensitively', () => {
    expect(matchesActiveTags(['Infra'], ['infra'])).toBe(true);
  });
});

describe('distinctTags', () => {
  it('lists every tag on the board once, sorted, ignoring case', () => {
    const blocks = [
      { tags: ['infra', 'API'] },
      { tags: ['Infra', 'ops'] },
      { tags: [] },
    ];
    expect(distinctTags(blocks)).toEqual(['API', 'infra', 'ops']);
  });

  it('is empty for a board with no tags at all', () => {
    expect(distinctTags([{ tags: [] }, { tags: [] }])).toEqual([]);
  });
});
