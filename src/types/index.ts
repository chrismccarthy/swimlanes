import type { BlockColor } from '../lib/colors';

/**
 * Re-exported so the rest of the app can keep importing it from `../types`.
 * The palette itself lives in `src/lib/colors.ts` (`ALL_COLORS`), which is the
 * single source of truth shared with the database CHECK constraint.
 */
export type { BlockColor };

/** A board's role for the signed-in user — owners may also manage the board. */
export type BoardRole = 'owner' | 'editor';

/** One team's board: its own members, blocks and sprint settings. */
export interface Board {
  id: string;
  name: string;
  /** The signed-in user's role on this board. */
  role: BoardRole;
  /** Version token for optimistic concurrency — see Block.updatedAt. */
  updatedAt: string;
}

/** A person with access to a board, as shown in the Board settings modal. */
export interface BoardMember {
  userId: string;
  email: string;
  role: BoardRole;
}

export interface Block {
  id: string;
  boardId: string;
  memberId: string;
  title: string;
  startDate: string;   // ISO "yyyy-MM-dd"
  endDate: string;     // ISO "yyyy-MM-dd" (inclusive)
  color: BlockColor;
  /**
   * Free-text labels, at most ten (see `src/lib/tags.ts`). Always present —
   * a block with no tags carries an empty array, never undefined.
   */
  tags: string[];
  /**
   * Version token for optimistic concurrency — the `updated_at` value the
   * server last reported for this row (ISO timestamp). Writes send it back as
   * `expectedUpdatedAt`; a mismatch means someone else edited the row first.
   */
  updatedAt: string;
}

/**
 * A block before it is attached to a board: the timeline builds one of these
 * when you drag out a new block, and the store stamps the current board on it.
 */
export type BlockDraft = Omit<Block, 'boardId'>;

export interface Member {
  id: string;
  boardId: string;
  name: string;
  sortOrder: number;
  /** Version token for optimistic concurrency — see Block.updatedAt. */
  updatedAt: string;
}

export interface SprintConfig {
  boardId: string;
  anchorDate: string;
  lengthDays: number;
  /** Version token for optimistic concurrency — see Block.updatedAt. */
  updatedAt: string;
}

/** An optional button on a toast, e.g. "Undo" after deleting a block. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  message: string;
  type: 'error' | 'info';
  action?: ToastAction;
}

export interface ContextMenuState {
  blockId: string;
  x: number;
  y: number;
}

export interface TrackAssignment {
  block: Block;
  trackIndex: number;
}

/** Timeline zoom level — controls how many pixels one day occupies */
export type ZoomLevel = 'day' | 'week' | 'quarter';

export interface SprintBoundary {
  sprintNumber: number;
  startDate: string;
  endDate: string;
}
