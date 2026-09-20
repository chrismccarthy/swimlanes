import { describe, it, expect } from 'vitest';
import {
  boardFromDb,
  boardMemberFromDb,
  memberFromDb,
  blockFromDb,
  sprintConfigFromDb,
} from './mappers';
import type { DbBoard, DbBoardMember, DbBlock, DbMember, DbSprintConfig } from './mappers';

const V1 = '2026-09-01T10:00:00.000Z';
const BOARD = '11111111-1111-1111-1111-111111111111';

describe('boardFromDb', () => {
  it('lifts the caller’s role out of the joined board_members row', () => {
    const row: DbBoard = {
      id: BOARD,
      name: 'Platform',
      updated_at: V1,
      board_members: [{ role: 'owner' }],
    };

    expect(boardFromDb(row)).toEqual({
      id: BOARD,
      name: 'Platform',
      role: 'owner',
      updatedAt: V1,
    });
  });

  it('falls back to the lower privilege for a missing or unknown role', () => {
    const base: DbBoard = { id: BOARD, name: 'Platform', updated_at: V1, board_members: [] };

    expect(boardFromDb(base).role).toBe('editor');
    expect(boardFromDb({ ...base, board_members: [{ role: 'admin' }] }).role).toBe('editor');
    expect(boardFromDb({ ...base, board_members: [{ role: 'editor' }] }).role).toBe('editor');
  });
});

describe('boardMemberFromDb', () => {
  it('maps the roster view row', () => {
    const row: DbBoardMember = { user_id: 'u1', email: 'ada@example.com', role: 'editor' };
    expect(boardMemberFromDb(row)).toEqual({
      userId: 'u1',
      email: 'ada@example.com',
      role: 'editor',
    });
  });

  it('tolerates a null email', () => {
    expect(boardMemberFromDb({ user_id: 'u1', email: null, role: 'owner' }).email).toBe('');
  });
});

describe('row mappers carry the board', () => {
  it('memberFromDb', () => {
    const row: DbMember = {
      id: 'm1',
      board_id: BOARD,
      name: 'Ada',
      sort_order: 1.5,
      created_at: V1,
      created_by: null,
      updated_at: V1,
      updated_by: null,
    };
    expect(memberFromDb(row)).toEqual({
      id: 'm1',
      boardId: BOARD,
      name: 'Ada',
      sortOrder: 1.5,
      updatedAt: V1,
    });
  });

  it('blockFromDb', () => {
    const row: DbBlock = {
      id: 'b1',
      board_id: BOARD,
      member_id: 'm1',
      title: 'Spec',
      start_date: '2026-09-10',
      end_date: '2026-09-12',
      color: 'purple',
      tags: ['infra', 'api'],
      created_at: V1,
      created_by: null,
      updated_at: V1,
      updated_by: null,
    };
    expect(blockFromDb(row)).toEqual({
      id: 'b1',
      boardId: BOARD,
      memberId: 'm1',
      title: 'Spec',
      startDate: '2026-09-10',
      endDate: '2026-09-12',
      color: 'purple',
      tags: ['infra', 'api'],
      updatedAt: V1,
    });
  });

  it('cleans the tags column, and copes with a row that has none', () => {
    const row: DbBlock = {
      id: 'b1',
      board_id: BOARD,
      member_id: 'm1',
      title: 'Spec',
      start_date: '2026-09-10',
      end_date: '2026-09-12',
      color: 'purple',
      tags: ['  infra  ', '', 'INFRA', 'api'],
      created_at: V1,
      created_by: null,
      updated_at: V1,
      updated_by: null,
    };
    // Trimmed, blanks dropped, case-insensitive duplicates folded away.
    expect(blockFromDb(row).tags).toEqual(['infra', 'api']);
    // A select that left the column out, or a row read through an older view.
    expect(blockFromDb({ ...row, tags: null }).tags).toEqual([]);
  });

  it('sprintConfigFromDb', () => {
    const row: DbSprintConfig = {
      board_id: BOARD,
      anchor_date: '2026-02-12',
      length_days: 14,
      updated_at: V1,
      updated_by: null,
    };
    expect(sprintConfigFromDb(row)).toEqual({
      boardId: BOARD,
      anchorDate: '2026-02-12',
      lengthDays: 14,
      updatedAt: V1,
    });
  });
});
