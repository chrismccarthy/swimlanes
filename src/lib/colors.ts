/**
 * The block palette, and the single source of truth for it.
 *
 * `BlockColor` is derived from this list (and re-exported from `src/types`), and
 * the `blocks_color_valid` CHECK constraint in
 * `supabase/migrations/006_constraints.sql` must contain exactly these values —
 * `colors.test.ts` parses the migration and asserts it.
 */
export const ALL_COLORS = [
  'blue', 'green', 'amber', 'red', 'purple', 'pink', 'teal', 'orange',
] as const;

export type BlockColor = (typeof ALL_COLORS)[number];

export interface ColorScheme {
  bg: string;
  text: string;
  border: string;
}

export const BLOCK_COLORS: Record<BlockColor, ColorScheme> = {
  blue:   { bg: '#DBEAFE', text: '#1E40AF', border: '#93C5FD' },
  green:  { bg: '#DCFCE7', text: '#166534', border: '#86EFAC' },
  amber:  { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
  red:    { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5' },
  purple: { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
  pink:   { bg: '#FCE7F3', text: '#9D174D', border: '#F9A8D4' },
  teal:   { bg: '#CCFBF1', text: '#115E59', border: '#5EEAD4' },
  orange: { bg: '#FFEDD5', text: '#9A3412', border: '#FDBA74' },
};
