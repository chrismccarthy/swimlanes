export type BlockColor =
  | 'blue'
  | 'green'
  | 'amber'
  | 'red'
  | 'purple'
  | 'pink'
  | 'teal'
  | 'orange';

export interface Block {
  id: string;
  memberId: string;
  title: string;
  startDate: string;   // ISO "yyyy-MM-dd"
  endDate: string;     // ISO "yyyy-MM-dd" (inclusive)
  color: BlockColor;
  /**
   * Version token for optimistic concurrency — the `updated_at` value the
   * server last reported for this row (ISO timestamp). Writes send it back as
   * `expectedUpdatedAt`; a mismatch means someone else edited the row first.
   */
  updatedAt: string;
}

export interface Member {
  id: string;
  name: string;
  sortOrder: number;
  /** Version token for optimistic concurrency — see Block.updatedAt. */
  updatedAt: string;
}

export interface SprintConfig {
  anchorDate: string;
  lengthDays: number;
  /** Version token for optimistic concurrency — see Block.updatedAt. */
  updatedAt: string;
}

export interface Toast {
  id: string;
  message: string;
  type: 'error' | 'info';
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
