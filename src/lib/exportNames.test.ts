import { describe, it, expect } from 'vitest';
import { slugify, exportFileName, DEFAULT_BOARD_NAME } from './exportNames';

describe('slugify', () => {
  it('lower-cases and dashes the words', () => {
    expect(slugify('Ada Lovelace')).toBe('ada-lovelace');
    expect(slugify(DEFAULT_BOARD_NAME)).toBe('team');
  });

  it('drops accents rather than the letters under them', () => {
    expect(slugify('Ada Ünal')).toBe('ada-unal');
    expect(slugify('José')).toBe('jose');
  });

  it('strips characters that have no business in a file name', () => {
    expect(slugify('Q3 / planning: "final"')).toBe('q3-planning-final');
    expect(slugify('  spaced  out  ')).toBe('spaced-out');
  });

  it('falls back to a usable name when nothing survives', () => {
    expect(slugify('***')).toBe('board');
    expect(slugify('')).toBe('board');
  });
});

describe('exportFileName', () => {
  it('names the file after the board and the day it was exported', () => {
    expect(exportFileName('Team', '2026-09-17', 'png')).toBe('swimlanes-team-2026-09-17.png');
    expect(exportFileName('Platform Crew', '2026-01-02', 'ics')).toBe(
      'swimlanes-platform-crew-2026-01-02.ics',
    );
  });
});
