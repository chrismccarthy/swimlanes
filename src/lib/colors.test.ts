import { describe, it, expect } from 'vitest';
// Imported as raw text (Vite's `?raw`) rather than read with `node:fs` so the
// test stays in the jsdom project and needs no Node types.
import constraintsSql from '../../supabase/migrations/006_constraints.sql?raw';
import { ALL_COLORS, BLOCK_COLORS } from './colors';

/**
 * Pull the colour list out of the `blocks_color_valid` CHECK constraint in
 * migration 006. Parsing the migration rather than restating the values is the
 * point: if someone adds a colour to the palette and forgets the migration (or
 * the other way round), this test fails.
 */
function colorsInMigration(): string[] {
  const clause = /ADD CONSTRAINT blocks_color_valid\s+CHECK \(color IN \(([^)]*)\)\)/.exec(
    constraintsSql,
  );
  if (!clause) throw new Error('blocks_color_valid CHECK constraint not found in 006_constraints.sql');
  return [...clause[1].matchAll(/'([^']*)'/g)].map(m => m[1]);
}

describe('block colour palette', () => {
  it('matches the blocks_color_valid CHECK constraint, in the same order', () => {
    expect(colorsInMigration()).toEqual([...ALL_COLORS]);
  });

  it('has a colour scheme for every colour and no extras', () => {
    expect(Object.keys(BLOCK_COLORS).sort()).toEqual([...ALL_COLORS].sort());
  });

  it('lists eight distinct colours', () => {
    expect(new Set(ALL_COLORS).size).toBe(8);
  });
});
