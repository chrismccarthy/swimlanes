import type { BlockColor } from '../types';

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

export const ALL_COLORS: BlockColor[] = [
  'blue', 'green', 'amber', 'red', 'purple', 'pink', 'teal', 'orange',
];
