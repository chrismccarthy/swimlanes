import type { Member, Block, BlockColor, SprintConfig } from '../../types';

// --- DB row types (snake_case) ---

export interface DbMember {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface DbBlock {
  id: string;
  member_id: string;
  title: string;
  start_date: string;
  end_date: string;
  color: string;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface DbSprintConfig {
  id: number;
  anchor_date: string;
  length_days: number;
  updated_at: string;
  updated_by: string | null;
}

// --- fromDb: DB row -> frontend type ---

export function memberFromDb(row: DbMember): Member {
  return { id: row.id, name: row.name, sortOrder: row.sort_order };
}

export function blockFromDb(row: DbBlock): Block {
  return {
    id: row.id,
    memberId: row.member_id,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    color: row.color as BlockColor,
  };
}

export function sprintConfigFromDb(row: DbSprintConfig): SprintConfig {
  return { anchorDate: row.anchor_date, lengthDays: row.length_days };
}
