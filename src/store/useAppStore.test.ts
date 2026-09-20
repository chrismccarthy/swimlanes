import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useAppStore,
  CONFLICT_BLOCK_MESSAGE,
  CONFLICT_MEMBER_MESSAGE,
  CONFLICT_SPRINT_MESSAGE,
  CONFLICT_BOARD_MESSAGE,
} from './useAppStore';
import { ConflictError } from '../lib/supabase/errors';
import { ZOOM_DAY_WIDTH } from '../lib/layout';
import type { Block, BlockDraft, Board, Member } from '../types';

// The data layer is mocked wholesale: Supabase is unreachable from a dev
// machine and from CI, so these tests assert what the store does with the
// promises the data modules hand back, not what the database does.
vi.mock('../lib/supabase/members', () => ({
  fetchMembers: vi.fn(),
  fetchMember: vi.fn(),
  insertMember: vi.fn(),
  updateMemberName: vi.fn(),
  updateMemberSortOrder: vi.fn(),
  deleteMember: vi.fn(),
}));

vi.mock('../lib/supabase/blocks', () => ({
  fetchBlocks: vi.fn(),
  fetchBlock: vi.fn(),
  insertBlock: vi.fn(),
  updateBlockFields: vi.fn(),
  deleteBlockById: vi.fn(),
}));

vi.mock('../lib/supabase/sprintConfig', () => ({
  fetchSprintConfig: vi.fn(),
  updateSprintConfigFields: vi.fn(),
}));

vi.mock('../lib/supabase/boards', () => ({
  supportsMemberManagement: true,
  memberManagementNote: '',
  fetchBoards: vi.fn(),
  createBoard: vi.fn(),
  renameBoard: vi.fn(),
  deleteBoard: vi.fn(),
  listBoardMembers: vi.fn(),
  addBoardMemberByEmail: vi.fn(),
  removeBoardMember: vi.fn(),
}));

import * as membersDb from '../lib/supabase/members';
import * as blocksDb from '../lib/supabase/blocks';
import * as sprintDb from '../lib/supabase/sprintConfig';
import * as boardsDb from '../lib/supabase/boards';

const members = vi.mocked(membersDb);
const blocks = vi.mocked(blocksDb);
const sprint = vi.mocked(sprintDb);
const boardsApi = vi.mocked(boardsDb);

/** Let every pending promise chain (including the conflict resolvers) settle. */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

const V1 = '2026-09-01T10:00:00.000Z';
const V2 = '2026-09-01T11:00:00.000Z';

/** Every test runs on a board; inserts are stamped with this id. */
const BOARD = 'board-1';

function makeBoard(overrides: Partial<Board> = {}): Board {
  return { id: BOARD, name: 'Team', role: 'owner', updatedAt: V1, ...overrides };
}

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: 'b1',
    boardId: BOARD,
    memberId: 'm1',
    title: 'Design review',
    startDate: '2026-09-10',
    endDate: '2026-09-12',
    color: 'blue',
    tags: [],
    updatedAt: V1,
    ...overrides,
  };
}

function makeMember(overrides: Partial<Member> = {}): Member {
  return { id: 'm1', boardId: BOARD, name: 'Ada', sortOrder: 1, updatedAt: V1, ...overrides };
}

const initialState = useAppStore.getState();

/** Current toast messages, oldest first. */
function toastMessages(): string[] {
  return useAppStore.getState().toasts.map(t => t.message);
}

beforeEach(() => {
  vi.clearAllMocks();
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  useAppStore.setState(initialState, true);
  useAppStore.getState().setUserId('user-1');
  useAppStore.setState({ boards: [makeBoard()], currentBoardId: BOARD });
});

describe('addMember', () => {
  it('adds optimistically, then stores the server version token', async () => {
    members.insertMember.mockResolvedValue(V2);

    useAppStore.getState().addMember('Ada');
    const optimistic = useAppStore.getState().members;
    expect(optimistic).toHaveLength(1);
    expect(optimistic[0].name).toBe('Ada');
    expect(members.insertMember).toHaveBeenCalledTimes(1);
    expect(members.insertMember.mock.calls[0][1]).toBe('user-1');

    await flush();
    expect(useAppStore.getState().members[0].updatedAt).toBe(V2);
    expect(toastMessages()).toEqual([]);
  });

  it('rolls the new member back out and toasts when the insert is rejected', async () => {
    members.insertMember.mockRejectedValue(new Error('boom'));

    useAppStore.getState().addMember('Ada');
    expect(useAppStore.getState().members).toHaveLength(1);

    await flush();
    expect(useAppStore.getState().members).toEqual([]);
    expect(toastMessages()).toEqual(['Failed to add member']);
    expect(useAppStore.getState().toasts[0].type).toBe('error');
  });

  it('keeps existing members when one insert fails', async () => {
    members.insertMember.mockRejectedValue(new Error('boom'));
    useAppStore.setState({ members: [makeMember()] });

    useAppStore.getState().addMember('Grace');
    await flush();

    expect(useAppStore.getState().members.map(m => m.name)).toEqual(['Ada']);
  });

  it('gives the new member the next sort order', () => {
    members.insertMember.mockResolvedValue(V2);
    useAppStore.setState({ members: [makeMember({ sortOrder: 7 })] });

    useAppStore.getState().addMember('Grace');
    expect(useAppStore.getState().members[1].sortOrder).toBe(8);
  });
});

describe('removeMember', () => {
  it('cascades to the member’s blocks and leaves other members alone', async () => {
    members.deleteMember.mockResolvedValue(undefined);
    useAppStore.setState({
      members: [makeMember(), makeMember({ id: 'm2', name: 'Grace' })],
      blocks: [makeBlock(), makeBlock({ id: 'b2', memberId: 'm2' })],
    });

    useAppStore.getState().removeMember('m1');

    expect(useAppStore.getState().members.map(m => m.id)).toEqual(['m2']);
    expect(useAppStore.getState().blocks.map(b => b.id)).toEqual(['b2']);

    await flush();
    expect(members.deleteMember).toHaveBeenCalledWith('m1');
    expect(toastMessages()).toEqual([]);
  });

  it('restores both members and their blocks when the delete fails', async () => {
    members.deleteMember.mockRejectedValue(new Error('boom'));
    const member = makeMember();
    const own = makeBlock();
    const other = makeBlock({ id: 'b2', memberId: 'm2' });
    useAppStore.setState({ members: [member], blocks: [own, other] });

    useAppStore.getState().removeMember('m1');
    expect(useAppStore.getState().blocks.map(b => b.id)).toEqual(['b2']);

    await flush();
    expect(useAppStore.getState().members).toEqual([member]);
    expect(useAppStore.getState().blocks.map(b => b.id)).toEqual(['b1', 'b2']);
    expect(toastMessages()).toEqual(['Failed to remove member']);
  });
});

describe('renameMember', () => {
  it('sends the version it last saw and stores the new one', async () => {
    members.updateMemberName.mockResolvedValue(V2);
    useAppStore.setState({ members: [makeMember()] });

    useAppStore.getState().renameMember('m1', 'Ada L.');
    expect(members.updateMemberName).toHaveBeenCalledWith('m1', 'Ada L.', V1);
    expect(useAppStore.getState().members[0].name).toBe('Ada L.');

    await flush();
    expect(useAppStore.getState().members[0].updatedAt).toBe(V2);
  });

  it('shows the winning version and warns when someone else got there first', async () => {
    const serverVersion = makeMember({ name: 'Ada Lovelace', updatedAt: V2 });
    members.updateMemberName.mockRejectedValue(new ConflictError('member', 'm1'));
    members.fetchMember.mockResolvedValue(serverVersion);
    useAppStore.setState({ members: [makeMember()] });

    useAppStore.getState().renameMember('m1', 'Ada L.');
    await flush();

    expect(members.fetchMember).toHaveBeenCalledWith('m1');
    // The other person's name wins — not ours, and not the stale one.
    expect(useAppStore.getState().members[0]).toEqual(serverVersion);
    expect(toastMessages()).toEqual([CONFLICT_MEMBER_MESSAGE]);
  });

  it('drops the member when the conflicting refetch finds it deleted', async () => {
    members.updateMemberName.mockRejectedValue(new ConflictError('member', 'm1'));
    members.fetchMember.mockResolvedValue(null);
    useAppStore.setState({ members: [makeMember()], blocks: [makeBlock()] });

    useAppStore.getState().renameMember('m1', 'Ada L.');
    await flush();

    expect(useAppStore.getState().members).toEqual([]);
    expect(useAppStore.getState().blocks).toEqual([]);
    expect(toastMessages()).toEqual([CONFLICT_MEMBER_MESSAGE]);
  });

  it('rolls back with the generic toast on a non-conflict failure', async () => {
    members.updateMemberName.mockRejectedValue(new Error('network'));
    useAppStore.setState({ members: [makeMember()] });

    useAppStore.getState().renameMember('m1', 'Ada L.');
    await flush();

    expect(members.fetchMember).not.toHaveBeenCalled();
    expect(useAppStore.getState().members[0].name).toBe('Ada');
    expect(toastMessages()).toEqual(['Failed to rename member']);
  });

  it('does nothing for an unknown member', () => {
    useAppStore.getState().renameMember('nope', 'Ada L.');
    expect(members.updateMemberName).not.toHaveBeenCalled();
  });
});

describe('updateBlock', () => {
  beforeEach(() => {
    useAppStore.setState({ blocks: [makeBlock()] });
  });

  it('writes the server’s updatedAt back on success', async () => {
    blocks.updateBlockFields.mockResolvedValue(V2);

    useAppStore.getState().updateBlock('b1', { title: 'Renamed' });

    expect(blocks.updateBlockFields).toHaveBeenCalledWith('b1', { title: 'Renamed' }, V1);
    expect(useAppStore.getState().blocks[0].title).toBe('Renamed');

    await flush();
    const block = useAppStore.getState().blocks[0];
    expect(block.updatedAt).toBe(V2);
    expect(block.title).toBe('Renamed');
    expect(toastMessages()).toEqual([]);
  });

  it('refetches and shows the server version on a conflict', async () => {
    const serverVersion = makeBlock({ title: 'Their title', endDate: '2026-09-20', updatedAt: V2 });
    blocks.updateBlockFields.mockRejectedValue(new ConflictError('block', 'b1'));
    blocks.fetchBlock.mockResolvedValue(serverVersion);

    useAppStore.getState().updateBlock('b1', { title: 'My title' });
    // Optimistically ours until the rejection lands.
    expect(useAppStore.getState().blocks[0].title).toBe('My title');

    await flush();
    expect(blocks.fetchBlock).toHaveBeenCalledWith('b1');
    expect(useAppStore.getState().blocks[0]).toEqual(serverVersion);
    expect(toastMessages()).toEqual([CONFLICT_BLOCK_MESSAGE]);
  });

  it('removes the block when the conflicting refetch finds it gone', async () => {
    blocks.updateBlockFields.mockRejectedValue(new ConflictError('block', 'b1'));
    blocks.fetchBlock.mockResolvedValue(null);
    useAppStore.setState({ selectedBlockId: 'b1' });

    useAppStore.getState().updateBlock('b1', { title: 'My title' });
    await flush();

    expect(useAppStore.getState().blocks).toEqual([]);
    expect(useAppStore.getState().selectedBlockId).toBeNull();
    expect(toastMessages()).toEqual([CONFLICT_BLOCK_MESSAGE]);
  });

  it('still warns when the conflicting refetch itself fails', async () => {
    blocks.updateBlockFields.mockRejectedValue(new ConflictError('block', 'b1'));
    blocks.fetchBlock.mockRejectedValue(new Error('offline'));

    useAppStore.getState().updateBlock('b1', { title: 'My title' });
    await flush();

    // Nothing better to show, so our optimistic value stays put.
    expect(useAppStore.getState().blocks[0].title).toBe('My title');
    expect(toastMessages()).toEqual([CONFLICT_BLOCK_MESSAGE]);
  });

  it('rolls back to the previous value with the generic toast on a plain failure', async () => {
    blocks.updateBlockFields.mockRejectedValue(new Error('network'));

    useAppStore.getState().updateBlock('b1', { title: 'My title', endDate: '2026-09-30' });
    await flush();

    expect(blocks.fetchBlock).not.toHaveBeenCalled();
    expect(useAppStore.getState().blocks[0]).toEqual(makeBlock());
    expect(toastMessages()).toEqual(['Failed to save block changes']);
  });

  it('updates a locked block in state without touching the data layer', () => {
    useAppStore.getState().lockBlock('b1');

    useAppStore.getState().updateBlock('b1', { startDate: '2026-09-11', endDate: '2026-09-13' });

    const block = useAppStore.getState().blocks[0];
    expect(block.startDate).toBe('2026-09-11');
    // The pre-drag version token must survive so commitBlock can send it.
    expect(block.updatedAt).toBe(V1);
    expect(blocks.updateBlockFields).not.toHaveBeenCalled();
    expect(toastMessages()).toEqual([]);
  });

  it('moves a locked block even while offline', () => {
    useAppStore.getState().lockBlock('b1');
    useAppStore.getState().setOnline(false);

    useAppStore.getState().updateBlock('b1', { startDate: '2026-09-11' });

    expect(useAppStore.getState().blocks[0].startDate).toBe('2026-09-11');
    expect(toastMessages()).toEqual([]);
  });

  it('leaves a locked block alone when the conflict resolver hears back', async () => {
    blocks.updateBlockFields.mockRejectedValue(new ConflictError('block', 'b1'));
    blocks.fetchBlock.mockResolvedValue(makeBlock({ title: 'Their title', updatedAt: V2 }));

    useAppStore.getState().updateBlock('b1', { title: 'My title' });
    // The user grabs the block before the rejection comes back.
    useAppStore.getState().lockBlock('b1');
    await flush();

    expect(useAppStore.getState().blocks[0].title).toBe('My title');
    expect(toastMessages()).toEqual([CONFLICT_BLOCK_MESSAGE]);
  });

  it('does nothing for an unknown block', () => {
    useAppStore.getState().updateBlock('nope', { title: 'x' });
    expect(blocks.updateBlockFields).not.toHaveBeenCalled();
  });
});

describe('commitBlock', () => {
  it('sends the version token from before the drag, then adopts the new one', async () => {
    blocks.updateBlockFields.mockResolvedValue(V2);
    useAppStore.setState({ blocks: [makeBlock()] });

    // Simulate a drag: lock, move optimistically, unlock, commit.
    useAppStore.getState().lockBlock('b1');
    useAppStore.getState().updateBlock('b1', { startDate: '2026-09-14', endDate: '2026-09-16' });
    useAppStore.getState().unlockBlock('b1');
    useAppStore.getState().commitBlock('b1');

    expect(blocks.updateBlockFields).toHaveBeenCalledTimes(1);
    expect(blocks.updateBlockFields).toHaveBeenCalledWith(
      'b1',
      { startDate: '2026-09-14', endDate: '2026-09-16' },
      V1
    );

    await flush();
    expect(useAppStore.getState().blocks[0].updatedAt).toBe(V2);
  });

  it('keeps the dragged position and warns when the commit fails', async () => {
    blocks.updateBlockFields.mockRejectedValue(new Error('network'));
    useAppStore.setState({ blocks: [makeBlock({ startDate: '2026-09-14', endDate: '2026-09-16' })] });

    useAppStore.getState().commitBlock('b1');
    await flush();

    // There is no pre-drag snapshot to roll back to here, so it stays put.
    expect(useAppStore.getState().blocks[0].startDate).toBe('2026-09-14');
    expect(toastMessages()).toEqual(['Failed to save block position']);
  });

  it('resolves the conflict when the row moved under the drag', async () => {
    const serverVersion = makeBlock({ startDate: '2026-10-01', endDate: '2026-10-03', updatedAt: V2 });
    blocks.updateBlockFields.mockRejectedValue(new ConflictError('block', 'b1'));
    blocks.fetchBlock.mockResolvedValue(serverVersion);
    useAppStore.setState({ blocks: [makeBlock({ startDate: '2026-09-14', endDate: '2026-09-16' })] });

    useAppStore.getState().commitBlock('b1');
    await flush();

    expect(useAppStore.getState().blocks[0]).toEqual(serverVersion);
    expect(toastMessages()).toEqual([CONFLICT_BLOCK_MESSAGE]);
  });

  it('does nothing for an unknown block', () => {
    useAppStore.getState().commitBlock('nope');
    expect(blocks.updateBlockFields).not.toHaveBeenCalled();
  });
});

describe('addBlock / deleteBlock / duplicateBlock', () => {
  it('adds optimistically and adopts the server version token', async () => {
    blocks.insertBlock.mockResolvedValue(V2);

    useAppStore.getState().addBlock(makeBlock());
    expect(useAppStore.getState().blocks).toHaveLength(1);

    await flush();
    expect(useAppStore.getState().blocks[0].updatedAt).toBe(V2);
  });

  it('rolls the added block back out on failure', async () => {
    blocks.insertBlock.mockRejectedValue(new Error('boom'));

    useAppStore.getState().addBlock(makeBlock());
    await flush();

    expect(useAppStore.getState().blocks).toEqual([]);
    expect(toastMessages()).toEqual(['Failed to add block']);
  });

  it('restores a deleted block when the delete fails', async () => {
    blocks.deleteBlockById.mockRejectedValue(new Error('boom'));
    useAppStore.setState({ blocks: [makeBlock()], selectedBlockId: 'b1' });

    useAppStore.getState().deleteBlock('b1');
    expect(useAppStore.getState().blocks).toEqual([]);
    expect(useAppStore.getState().selectedBlockId).toBeNull();

    await flush();
    expect(useAppStore.getState().blocks).toEqual([makeBlock()]);
    expect(toastMessages()).toEqual(['Failed to delete block']);
  });

  it('copies a block one day later with a "(copy)" title', () => {
    blocks.insertBlock.mockResolvedValue(V2);
    useAppStore.setState({ blocks: [makeBlock()] });

    useAppStore.getState().duplicateBlock('b1');

    const [original, copy] = useAppStore.getState().blocks;
    expect(original).toEqual(makeBlock());
    expect(copy.id).not.toBe(original.id);
    expect(copy.title).toBe('Design review (copy)');
    expect(copy.startDate).toBe('2026-09-11');
    expect(copy.endDate).toBe('2026-09-13');
    expect(copy.memberId).toBe(original.memberId);
    expect(copy.color).toBe(original.color);
    expect(useAppStore.getState().contextMenu).toBeNull();
  });

  it('shifts a copy across a month boundary', () => {
    blocks.insertBlock.mockResolvedValue(V2);
    useAppStore.setState({ blocks: [makeBlock({ startDate: '2026-09-29', endDate: '2026-09-30' })] });

    useAppStore.getState().duplicateBlock('b1');

    const copy = useAppStore.getState().blocks[1];
    expect([copy.startDate, copy.endDate]).toEqual(['2026-09-30', '2026-10-01']);
  });

  it('removes the copy again when its insert fails', async () => {
    blocks.insertBlock.mockRejectedValue(new Error('boom'));
    useAppStore.setState({ blocks: [makeBlock()] });

    useAppStore.getState().duplicateBlock('b1');
    expect(useAppStore.getState().blocks).toHaveLength(2);

    await flush();
    expect(useAppStore.getState().blocks).toEqual([makeBlock()]);
    expect(toastMessages()).toEqual(['Failed to duplicate block']);
  });

  it('does nothing for an unknown block', () => {
    useAppStore.getState().duplicateBlock('nope');
    expect(blocks.insertBlock).not.toHaveBeenCalled();
  });
});

describe('updateSprintSettings', () => {
  it('stores the new version token on success', async () => {
    sprint.updateSprintConfigFields.mockResolvedValue(V2);
    useAppStore.setState({ sprintUpdatedAt: V1 });

    useAppStore.getState().updateSprintSettings('2026-03-05', 7);
    expect(sprint.updateSprintConfigFields).toHaveBeenCalledWith(BOARD, '2026-03-05', 7, V1);

    await flush();
    expect(useAppStore.getState().sprintUpdatedAt).toBe(V2);
    expect(useAppStore.getState().sprintLengthDays).toBe(7);
  });

  it('adopts the server config on a conflict', async () => {
    sprint.updateSprintConfigFields.mockRejectedValue(new ConflictError('sprint settings'));
    sprint.fetchSprintConfig.mockResolvedValue({
      boardId: BOARD,
      anchorDate: '2026-04-01',
      lengthDays: 21,
      updatedAt: V2,
    });
    useAppStore.setState({ sprintAnchorDate: '2026-02-12', sprintLengthDays: 14, sprintUpdatedAt: V1 });

    useAppStore.getState().updateSprintSettings('2026-03-05', 7);
    await flush();

    expect(useAppStore.getState().sprintAnchorDate).toBe('2026-04-01');
    expect(useAppStore.getState().sprintLengthDays).toBe(21);
    expect(useAppStore.getState().sprintUpdatedAt).toBe(V2);
    expect(toastMessages()).toEqual([CONFLICT_SPRINT_MESSAGE]);
  });

  it('rolls back to the previous settings on a plain failure', async () => {
    sprint.updateSprintConfigFields.mockRejectedValue(new Error('network'));
    useAppStore.setState({ sprintAnchorDate: '2026-02-12', sprintLengthDays: 14, sprintUpdatedAt: V1 });

    useAppStore.getState().updateSprintSettings('2026-03-05', 7);
    await flush();

    expect(useAppStore.getState().sprintAnchorDate).toBe('2026-02-12');
    expect(useAppStore.getState().sprintLengthDays).toBe(14);
    expect(toastMessages()).toEqual(['Failed to save sprint settings']);
  });
});

describe('offline', () => {
  const OFFLINE = 'Cannot save while offline';

  beforeEach(() => {
    useAppStore.setState({ members: [makeMember()], blocks: [makeBlock()] });
    useAppStore.getState().setOnline(false);
  });

  it('refuses every write with one toast and no data-module call', () => {
    const store = useAppStore.getState();
    store.addMember('Grace');
    store.removeMember('m1');
    store.renameMember('m1', 'Ada L.');
    store.moveMember('m1', 5);
    store.addBlock(makeBlock({ id: 'b2' }));
    store.updateBlock('b1', { title: 'nope' });
    store.deleteBlock('b1');
    store.duplicateBlock('b1');
    store.commitBlock('b1');
    store.updateSprintSettings('2026-03-05', 7);

    expect(toastMessages()).toEqual(Array(10).fill(OFFLINE));
    expect(toastMessages().every(m => m === OFFLINE)).toBe(true);

    for (const fn of [
      members.insertMember,
      members.deleteMember,
      members.updateMemberName,
      members.updateMemberSortOrder,
      blocks.insertBlock,
      blocks.updateBlockFields,
      blocks.deleteBlockById,
      sprint.updateSprintConfigFields,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('leaves the data untouched while offline', () => {
    useAppStore.getState().updateBlock('b1', { title: 'nope' });
    useAppStore.getState().removeMember('m1');

    expect(useAppStore.getState().blocks).toEqual([makeBlock()]);
    expect(useAppStore.getState().members).toEqual([makeMember()]);
  });

  it('lets writes through again once back online', async () => {
    blocks.updateBlockFields.mockResolvedValue(V2);
    useAppStore.getState().setOnline(true);

    useAppStore.getState().updateBlock('b1', { title: 'Renamed' });
    await flush();

    expect(blocks.updateBlockFields).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().blocks[0].updatedAt).toBe(V2);
  });
});

describe('setZoom', () => {
  it('updates dayWidth to match the level and persists the choice', () => {
    useAppStore.getState().setZoom('week');
    expect(useAppStore.getState().zoom).toBe('week');
    expect(useAppStore.getState().dayWidth).toBe(ZOOM_DAY_WIDTH.week);
    expect(localStorage.getItem('swimlanes.zoom')).toBe('week');

    useAppStore.getState().setZoom('quarter');
    expect(useAppStore.getState().dayWidth).toBe(ZOOM_DAY_WIDTH.quarter);
    expect(localStorage.getItem('swimlanes.zoom')).toBe('quarter');

    useAppStore.getState().setZoom('day');
    expect(useAppStore.getState().dayWidth).toBe(ZOOM_DAY_WIDTH.day);
    expect(localStorage.getItem('swimlanes.zoom')).toBe('day');
  });

  it('does not persist a no-op re-selection of the current level', () => {
    expect(useAppStore.getState().zoom).toBe('day');
    useAppStore.getState().setZoom('day');
    expect(localStorage.getItem('swimlanes.zoom')).toBeNull();
  });
});

describe('tag filter', () => {
  it('toggles a tag on and off', () => {
    useAppStore.getState().toggleTag('infra');
    expect(useAppStore.getState().activeTags).toEqual(['infra']);

    useAppStore.getState().toggleTag('api');
    expect(useAppStore.getState().activeTags).toEqual(['infra', 'api']);

    useAppStore.getState().toggleTag('infra');
    expect(useAppStore.getState().activeTags).toEqual(['api']);
  });

  it('treats tags that differ only in case as the same filter', () => {
    useAppStore.getState().toggleTag('Infra');
    useAppStore.getState().toggleTag('INFRA');
    expect(useAppStore.getState().activeTags).toEqual([]);
  });

  it('trims what it is given and ignores a blank tag', () => {
    useAppStore.getState().toggleTag('  infra  ');
    expect(useAppStore.getState().activeTags).toEqual(['infra']);

    useAppStore.getState().toggleTag('   ');
    expect(useAppStore.getState().activeTags).toEqual(['infra']);
  });

  it('clears every active tag at once', () => {
    useAppStore.getState().toggleTag('infra');
    useAppStore.getState().toggleTag('api');
    useAppStore.getState().clearTags();
    expect(useAppStore.getState().activeTags).toEqual([]);
  });

  it('drops the filter when the board changes — it belonged to the old board', () => {
    useAppStore.setState({ boards: [makeBoard(), makeBoard({ id: 'board-2' })] });
    useAppStore.getState().toggleTag('infra');

    useAppStore.getState().setCurrentBoard('board-2');
    expect(useAppStore.getState().activeTags).toEqual([]);
  });

  it('is not persisted: a filter is a way of looking, not a setting', () => {
    useAppStore.getState().toggleTag('infra');
    const stored = Object.keys(localStorage).filter(k => k.startsWith('swimlanes.'));
    expect(stored).not.toContain('swimlanes.tags');
    expect(
      stored.some(k => (localStorage.getItem(k) ?? '').includes('infra')),
    ).toBe(false);
  });
});

describe('realtime merge helpers', () => {
  it('replaces a known block and appends an unknown one', () => {
    useAppStore.setState({ blocks: [makeBlock()] });

    useAppStore.getState().mergeRemoteBlock(
      makeBlock({ title: 'Theirs', tags: ['infra'], updatedAt: V2 }),
    );
    expect(useAppStore.getState().blocks).toHaveLength(1);
    expect(useAppStore.getState().blocks[0].title).toBe('Theirs');
    // The whole row is swapped in, so a tag someone else added arrives with it.
    expect(useAppStore.getState().blocks[0].tags).toEqual(['infra']);

    useAppStore.getState().mergeRemoteBlock(makeBlock({ id: 'b2' }));
    expect(useAppStore.getState().blocks.map(b => b.id)).toEqual(['b1', 'b2']);
  });

  it('cascades a remote member removal to that member’s blocks', () => {
    useAppStore.setState({
      members: [makeMember(), makeMember({ id: 'm2' })],
      blocks: [makeBlock(), makeBlock({ id: 'b2', memberId: 'm2' })],
    });

    useAppStore.getState().removeRemoteMember('m1');

    expect(useAppStore.getState().members.map(m => m.id)).toEqual(['m2']);
    expect(useAppStore.getState().blocks.map(b => b.id)).toEqual(['b2']);
  });
});

describe('boards', () => {
  it('creates a board optimistically, adopts the server row and switches to it', async () => {
    const created: Board = { id: 'b-new', name: 'Platform', role: 'owner', updatedAt: V2 };
    boardsApi.createBoard.mockImplementation((name, id) =>
      Promise.resolve({ ...created, id: id ?? created.id, name }));

    useAppStore.getState().createBoard('Platform');

    // Optimistic: the board is listed and current before the insert lands.
    const optimistic = useAppStore.getState().boards;
    expect(optimistic).toHaveLength(2);
    expect(optimistic[1].name).toBe('Platform');
    const newId = optimistic[1].id;
    expect(useAppStore.getState().currentBoardId).toBe(newId);
    // The generated id is handed to the data layer, so both rows are one board.
    expect(boardsApi.createBoard).toHaveBeenCalledWith('Platform', newId);

    await flush();
    expect(useAppStore.getState().boards[1].updatedAt).toBe(V2);
    expect(useAppStore.getState().currentBoardId).toBe(newId);
    expect(toastMessages()).toEqual([]);
  });

  it('rolls the new board back out and returns to the previous one on failure', async () => {
    boardsApi.createBoard.mockRejectedValue(new Error('boom'));

    useAppStore.getState().createBoard('Platform');
    expect(useAppStore.getState().boards).toHaveLength(2);

    await flush();
    expect(useAppStore.getState().boards).toEqual([makeBoard()]);
    expect(useAppStore.getState().currentBoardId).toBe(BOARD);
    expect(toastMessages()).toEqual(['Failed to create board']);
  });

  it('renames a board with the version it last saw, then stores the new one', async () => {
    boardsApi.renameBoard.mockResolvedValue(V2);

    useAppStore.getState().renameBoard(BOARD, 'Platform');
    expect(useAppStore.getState().boards[0].name).toBe('Platform');
    expect(boardsApi.renameBoard).toHaveBeenCalledWith(BOARD, 'Platform', V1);

    await flush();
    expect(useAppStore.getState().boards[0].updatedAt).toBe(V2);
  });

  it('shows the winning board list and warns when a rename conflicts', async () => {
    boardsApi.renameBoard.mockRejectedValue(new ConflictError('board', BOARD));
    boardsApi.fetchBoards.mockResolvedValue([makeBoard({ name: 'Renamed elsewhere', updatedAt: V2 })]);

    useAppStore.getState().renameBoard(BOARD, 'Platform');
    await flush();

    expect(useAppStore.getState().boards[0].name).toBe('Renamed elsewhere');
    expect(toastMessages()).toEqual([CONFLICT_BOARD_MESSAGE]);
  });

  it('rolls a rename back with the generic toast on a plain failure', async () => {
    boardsApi.renameBoard.mockRejectedValue(new Error('boom'));

    useAppStore.getState().renameBoard(BOARD, 'Platform');
    await flush();

    expect(useAppStore.getState().boards[0].name).toBe('Team');
    expect(toastMessages()).toEqual(['Failed to rename board']);
  });

  it('deletes a board and moves to the one that is left', async () => {
    boardsApi.deleteBoard.mockResolvedValue(undefined);
    const other = makeBoard({ id: 'board-2', name: 'Platform' });
    useAppStore.setState({ boards: [makeBoard(), other], members: [makeMember()] });

    useAppStore.getState().deleteBoard(BOARD);

    expect(useAppStore.getState().boards).toEqual([other]);
    expect(useAppStore.getState().currentBoardId).toBe('board-2');
    // Switching boards drops the previous board's rows.
    expect(useAppStore.getState().members).toEqual([]);

    await flush();
    expect(boardsApi.deleteBoard).toHaveBeenCalledWith(BOARD);
    expect(toastMessages()).toEqual([]);
  });

  it('restores the board when the delete fails', async () => {
    boardsApi.deleteBoard.mockRejectedValue(new Error('boom'));
    useAppStore.setState({ boards: [makeBoard(), makeBoard({ id: 'board-2', name: 'Platform' })] });

    useAppStore.getState().deleteBoard(BOARD);
    await flush();

    expect(useAppStore.getState().boards).toHaveLength(2);
    expect(useAppStore.getState().currentBoardId).toBe(BOARD);
    expect(toastMessages()).toEqual(['Failed to delete board']);
  });

  it('refuses to delete your only board', () => {
    useAppStore.getState().deleteBoard(BOARD);

    expect(boardsApi.deleteBoard).not.toHaveBeenCalled();
    expect(useAppStore.getState().boards).toHaveLength(1);
    expect(toastMessages()).toEqual(['You cannot delete your only board']);
  });

  it('persists the current board and clears the previous board’s data on a switch', () => {
    useAppStore.setState({
      boards: [makeBoard(), makeBoard({ id: 'board-2', name: 'Platform' })],
      members: [makeMember()],
      blocks: [makeBlock()],
      selectedBlockId: 'b1',
    });

    useAppStore.getState().setCurrentBoard('board-2');

    expect(useAppStore.getState().currentBoardId).toBe('board-2');
    expect(localStorage.getItem('swimlanes.board')).toBe('board-2');
    expect(useAppStore.getState().members).toEqual([]);
    expect(useAppStore.getState().blocks).toEqual([]);
    expect(useAppStore.getState().selectedBlockId).toBeNull();
  });

  it('does not re-clear when the current board is re-selected', () => {
    useAppStore.setState({ members: [makeMember()] });

    useAppStore.getState().setCurrentBoard(BOARD);

    expect(useAppStore.getState().members).toHaveLength(1);
    expect(localStorage.getItem('swimlanes.board')).toBeNull();
  });
});

describe('inserts are stamped with the current board', () => {
  it('stamps a new member', () => {
    members.insertMember.mockResolvedValue(V2);

    useAppStore.getState().addMember('Grace');

    expect(useAppStore.getState().members[0].boardId).toBe(BOARD);
    expect(members.insertMember.mock.calls[0][0].boardId).toBe(BOARD);
  });

  it('stamps a block the timeline drew without knowing about boards', () => {
    blocks.insertBlock.mockResolvedValue(V2);
    const full = makeBlock({ id: 'b9' });
    // What the timeline hands over: a block with no board on it.
    const draft: BlockDraft = {
      id: full.id,
      memberId: full.memberId,
      title: full.title,
      startDate: full.startDate,
      endDate: full.endDate,
      color: full.color,
      tags: full.tags,
      updatedAt: full.updatedAt,
    };

    useAppStore.getState().addBlock(draft);

    expect(useAppStore.getState().blocks[0].boardId).toBe(BOARD);
    expect(blocks.insertBlock.mock.calls[0][0].boardId).toBe(BOARD);
  });

  it('stamps a duplicated block with the board it is on now', () => {
    blocks.insertBlock.mockResolvedValue(V2);
    useAppStore.setState({ blocks: [makeBlock({ boardId: 'board-old' })] });

    useAppStore.getState().duplicateBlock('b1');

    const copy = useAppStore.getState().blocks[1];
    expect(copy.boardId).toBe(BOARD);
    expect(blocks.insertBlock.mock.calls[0][0].boardId).toBe(BOARD);
  });
});
