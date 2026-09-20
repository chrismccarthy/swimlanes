import type { Board, BoardMember, BoardRole, Member, Block, BlockColor, SprintConfig } from '../../types';
import { normaliseTags } from '../tags';

// --- DB row types (snake_case) ---

export interface DbBoard {
  id: string;
  name: string;
  updated_at: string;
  /** Embedded rows from the `board_members!inner(role)` join in fetchBoards. */
  board_members: { role: string }[];
}

export interface DbBoardMember {
  user_id: string;
  email: string | null;
  role: string;
}

export interface DbMember {
  id: string;
  board_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface DbBlock {
  id: string;
  board_id: string;
  member_id: string;
  title: string;
  start_date: string;
  end_date: string;
  color: string;
  /** `text[]` column added in 009; null-tolerant because older rows predate it. */
  tags: string[] | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface DbSprintConfig {
  board_id: string;
  anchor_date: string;
  length_days: number;
  updated_at: string;
  updated_by: string | null;
}

// --- fromDb: DB row -> frontend type ---

/** Anything unexpected is treated as the lower privilege. */
function boardRole(value: unknown): BoardRole {
  return value === 'owner' ? 'owner' : 'editor';
}

export function boardFromDb(row: DbBoard): Board {
  return {
    id: row.id,
    name: row.name,
    // The join is filtered to the caller, so there is exactly one row here.
    role: boardRole(row.board_members[0]?.role),
    updatedAt: row.updated_at,
  };
}

export function boardMemberFromDb(row: DbBoardMember): BoardMember {
  return {
    userId: row.user_id,
    email: row.email ?? '',
    role: boardRole(row.role),
  };
}

export function memberFromDb(row: DbMember): Member {
  return {
    id: row.id,
    boardId: row.board_id,
    name: row.name,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  };
}

export function blockFromDb(row: DbBlock): Block {
  return {
    id: row.id,
    boardId: row.board_id,
    memberId: row.member_id,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    color: row.color as BlockColor,
    // The column is NOT NULL in the database; the fallback covers a row read
    // through an older view or a PostgREST select that omitted the column.
    tags: normaliseTags(row.tags),
    updatedAt: row.updated_at,
  };
}

export function sprintConfigFromDb(row: DbSprintConfig): SprintConfig {
  return {
    boardId: row.board_id,
    anchorDate: row.anchor_date,
    lengthDays: row.length_days,
    updatedAt: row.updated_at,
  };
}
