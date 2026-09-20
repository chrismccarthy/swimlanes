import { describe, it, expect } from 'vitest';
import { migrateLocalData, emptyLocalData, DEFAULT_BOARD_NAME } from './backend';

/**
 * The localStorage-backed artifact build gained boards after people had
 * already used it, so anything written by the older shape — a flat member
 * list, a flat block list and one `sprint` document — has to be adopted into
 * a default board rather than dropped.
 */

const EPOCH = new Date(0).toISOString();
const V1 = '2026-09-01T10:00:00.000Z';
const NEW_BOARD = 'generated-board-id';

describe('migrateLocalData', () => {
  it('adopts pre-board data into one board named "Team"', () => {
    const legacy = {
      members: [{ id: 'm1', name: 'Ada', sortOrder: 1, updatedAt: V1 }],
      blocks: [{
        id: 'b1',
        memberId: 'm1',
        title: 'Spec',
        startDate: '2026-09-10',
        endDate: '2026-09-12',
        color: 'blue',
        updatedAt: V1,
      }],
      sprint: { anchorDate: '2026-03-05', lengthDays: 7, updatedAt: V1 },
    };

    const data = migrateLocalData(legacy, NEW_BOARD);

    expect(data.boards).toEqual([
      { id: NEW_BOARD, name: DEFAULT_BOARD_NAME, role: 'owner', updatedAt: EPOCH },
    ]);
    expect(data.members).toHaveLength(1);
    expect(data.members[0]).toMatchObject({ id: 'm1', name: 'Ada', boardId: NEW_BOARD });
    expect(data.blocks[0]).toMatchObject({ id: 'b1', title: 'Spec', boardId: NEW_BOARD });
    // The single old sprint document becomes that board's settings.
    expect(data.sprints[NEW_BOARD]).toEqual({
      boardId: NEW_BOARD,
      anchorDate: '2026-03-05',
      lengthDays: 7,
      updatedAt: V1,
    });
  });

  it('gives pre-concurrency rows the epoch version token', () => {
    const legacy = {
      members: [{ id: 'm1', name: 'Ada', sortOrder: 1 }],
      sprint: { anchorDate: '2026-03-05', lengthDays: 7 },
    };

    const data = migrateLocalData(legacy, NEW_BOARD);

    expect(data.members[0].updatedAt).toBe(EPOCH);
    expect(data.sprints[NEW_BOARD].updatedAt).toBe(EPOCH);
  });

  it('gives blocks written before tags existed an empty tag list', () => {
    const legacy = {
      blocks: [
        { id: 'b1', memberId: 'm1', title: 'Spec', startDate: '2026-09-10', endDate: '2026-09-12', color: 'blue', updatedAt: V1 },
        { id: 'b2', memberId: 'm1', title: 'Build', startDate: '2026-09-10', endDate: '2026-09-12', color: 'blue', updatedAt: V1, tags: ['  infra ', '', 'INFRA'] },
      ],
    };

    const data = migrateLocalData(legacy, NEW_BOARD);

    // Never undefined: the app reads block.tags without guarding.
    expect(data.blocks[0].tags).toEqual([]);
    // Stored tags are cleaned on the way in, the same as any other source.
    expect(data.blocks[1].tags).toEqual(['infra']);
  });

  it('invents no board for an empty store', () => {
    expect(migrateLocalData({}, NEW_BOARD)).toEqual(emptyLocalData());
    expect(migrateLocalData(null, NEW_BOARD)).toEqual(emptyLocalData());
    expect(migrateLocalData({ members: [], blocks: [] }, NEW_BOARD)).toEqual(emptyLocalData());
  });

  it('leaves data that already has boards alone', () => {
    const current = {
      boards: [{ id: 'board-1', name: 'Platform', role: 'owner', updatedAt: V1 }],
      members: [{ id: 'm1', boardId: 'board-1', name: 'Ada', sortOrder: 1, updatedAt: V1 }],
      blocks: [],
      sprints: {
        'board-1': { boardId: 'board-1', anchorDate: '2026-02-12', lengthDays: 14, updatedAt: V1 },
      },
    };

    const data = migrateLocalData(current, NEW_BOARD);

    expect(data.boards).toEqual(current.boards);
    expect(data.members[0].boardId).toBe('board-1');
    expect(data.sprints['board-1'].lengthDays).toBe(14);
  });

  it('attaches stray unstamped rows to the board that already exists', () => {
    const mixed = {
      boards: [{ id: 'board-1', name: 'Platform', role: 'owner', updatedAt: V1 }],
      members: [
        { id: 'm1', boardId: 'board-1', name: 'Ada', sortOrder: 1, updatedAt: V1 },
        { id: 'm2', name: 'Grace', sortOrder: 2, updatedAt: V1 },
      ],
    };

    const data = migrateLocalData(mixed, NEW_BOARD);

    expect(data.boards).toHaveLength(1);
    expect(data.members.map(m => m.boardId)).toEqual(['board-1', 'board-1']);
  });

  it('ignores junk instead of throwing', () => {
    const data = migrateLocalData({ members: 'nope', blocks: 42, sprints: null }, NEW_BOARD);
    expect(data).toEqual(emptyLocalData());
  });
});
