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
}

export interface Member {
  id: string;
  name: string;
  order: number;
}

export interface AppState {
  members: Member[];
  blocks: Block[];
  sprintAnchorDate: string;
  sprintLengthDays: number;
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

export interface SprintBoundary {
  sprintNumber: number;
  startDate: string;
  endDate: string;
}
