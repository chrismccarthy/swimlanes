import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppStore } from './useAppStore';
import { useUndoStore } from './undo';
import { nudgeBlock, flushNudge, hasPendingNudge, resetNudgeForTest, NUDGE_DEBOUNCE_MS } from './nudge';
import type { Block, Board } from '../types';

// Same shape as the store's own suite: Supabase is unreachable here, so the
// data modules are mocked and we assert on the writes the store attempts.
vi.mock('../lib/supabase/members', () => ({
  fetchMembers: vi.fn(), fetchMember: vi.fn(), insertMember: vi.fn(),
  updateMemberName: vi.fn(), updateMemberSortOrder: vi.fn(), deleteMember: vi.fn(),
}));
vi.mock('../lib/supabase/blocks', () => ({
  fetchBlocks: vi.fn(), fetchBlock: vi.fn(), insertBlock: vi.fn(),
  updateBlockFields: vi.fn(), deleteBlockById: vi.fn(),
}));
vi.mock('../lib/supabase/sprintConfig', () => ({
  fetchSprintConfig: vi.fn(), updateSprintConfigFields: vi.fn(),
}));
vi.mock('../lib/supabase/boards', () => ({
  supportsMemberManagement: true, memberManagementNote: '',
  fetchBoards: vi.fn(), createBoard: vi.fn(), renameBoard: vi.fn(), deleteBoard: vi.fn(),
  listBoardMembers: vi.fn(), addBoardMemberByEmail: vi.fn(), removeBoardMember: vi.fn(),
}));

import * as blocksDb from '../lib/supabase/blocks';
const blocks = vi.mocked(blocksDb);

const V1 = '2026-09-01T10:00:00.000Z';
const V2 = '2026-09-01T11:00:00.000Z';
const BOARD = 'board-1';

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: 'b1',
    boardId: BOARD,
    memberId: 'm1',
    title: 'Design spike',
    startDate: '2026-09-10',
    endDate: '2026-09-12',
    color: 'blue',
    tags: [],
    updatedAt: V1,
    ...overrides,
  };
}

const board: Board = { id: BOARD, name: 'Team', role: 'owner', updatedAt: V1 };
const initialState = useAppStore.getState();

function currentBlock(): Block {
  const block = useAppStore.getState().blocks.find(b => b.id === 'b1');
  if (!block) throw new Error('block b1 is gone');
  return block;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  useAppStore.setState(initialState, true);
  useAppStore.getState().setUserId('user-1');
  useAppStore.setState({ boards: [board], currentBoardId: BOARD, blocks: [makeBlock()] });
  useUndoStore.setState({ past: [], future: [], isReplaying: false });
  blocks.updateBlockFields.mockResolvedValue(V2);
});

afterEach(() => {
  resetNudgeForTest();
  vi.useRealTimers();
});

describe('nudgeBlock', () => {
  it('moves the block immediately but writes nothing until the key stops repeating', async () => {
    nudgeBlock('b1', { startDate: '2026-09-11', endDate: '2026-09-13' });

    expect(currentBlock().startDate).toBe('2026-09-11');
    expect(blocks.updateBlockFields).not.toHaveBeenCalled();
    // Locked for the burst, so realtime cannot pull the block around mid-nudge.
    expect(useAppStore.getState().lockedBlockIds.has('b1')).toBe(true);

    await vi.advanceTimersByTimeAsync(NUDGE_DEBOUNCE_MS);

    expect(blocks.updateBlockFields).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().lockedBlockIds.has('b1')).toBe(false);
  });

  it('coalesces a burst of presses into one write from the pre-burst version', async () => {
    for (let day = 11; day <= 15; day++) {
      nudgeBlock('b1', { startDate: `2026-09-${day}`, endDate: `2026-09-${day + 2}` });
      await vi.advanceTimersByTimeAsync(50); // key repeat, faster than the debounce
    }

    expect(blocks.updateBlockFields).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(NUDGE_DEBOUNCE_MS);

    expect(blocks.updateBlockFields).toHaveBeenCalledTimes(1);
    expect(blocks.updateBlockFields).toHaveBeenCalledWith(
      'b1',
      { startDate: '2026-09-15', endDate: '2026-09-17' },
      V1, // the version the block had before the first press
    );
    expect(currentBlock().updatedAt).toBe(V2);
  });

  it('records one undo step for the whole burst', async () => {
    nudgeBlock('b1', { startDate: '2026-09-11', endDate: '2026-09-13' });
    nudgeBlock('b1', { startDate: '2026-09-12', endDate: '2026-09-14' });
    await vi.advanceTimersByTimeAsync(NUDGE_DEBOUNCE_MS);

    const { past } = useUndoStore.getState();
    expect(past).toHaveLength(1);
    expect(past[0].label).toBe('Move block');

    useUndoStore.getState().undo();
    expect(currentBlock().startDate).toBe('2026-09-10');
    expect(currentBlock().endDate).toBe('2026-09-12');
  });

  it('flushes the pending write when another block is nudged', async () => {
    useAppStore.setState({ blocks: [makeBlock(), makeBlock({ id: 'b2' })] });

    nudgeBlock('b1', { startDate: '2026-09-11', endDate: '2026-09-13' });
    nudgeBlock('b2', { startDate: '2026-09-11', endDate: '2026-09-13' });

    expect(blocks.updateBlockFields).toHaveBeenCalledTimes(1);
    expect(blocks.updateBlockFields.mock.calls[0][0]).toBe('b1');
    expect(useAppStore.getState().lockedBlockIds.has('b1')).toBe(false);
    expect(useAppStore.getState().lockedBlockIds.has('b2')).toBe(true);

    await vi.advanceTimersByTimeAsync(NUDGE_DEBOUNCE_MS);
    expect(blocks.updateBlockFields).toHaveBeenCalledTimes(2);
  });

  it('flushes on demand, and does nothing when there is nothing pending', async () => {
    nudgeBlock('b1', { startDate: '2026-09-11', endDate: '2026-09-13' });
    expect(hasPendingNudge()).toBe(true);

    flushNudge();
    expect(hasPendingNudge()).toBe(false);
    expect(blocks.updateBlockFields).toHaveBeenCalledTimes(1);

    flushNudge();
    expect(blocks.updateBlockFields).toHaveBeenCalledTimes(1);

    // The debounce timer must not fire a second write after a manual flush.
    await vi.advanceTimersByTimeAsync(NUDGE_DEBOUNCE_MS);
    expect(blocks.updateBlockFields).toHaveBeenCalledTimes(1);
  });

  it('refuses to nudge while offline', () => {
    useAppStore.setState({ isOnline: false });

    nudgeBlock('b1', { startDate: '2026-09-11', endDate: '2026-09-13' });

    expect(currentBlock().startDate).toBe('2026-09-10');
    expect(hasPendingNudge()).toBe(false);
    expect(useAppStore.getState().toasts.map(t => t.message)).toEqual(['Cannot save while offline']);
  });

  it('ignores a block that is no longer there', () => {
    nudgeBlock('gone', { startDate: '2026-09-11' });
    expect(hasPendingNudge()).toBe(false);
    expect(blocks.updateBlockFields).not.toHaveBeenCalled();
  });
});
