import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore, RECONCILE_FAILED_MESSAGE } from './useAppStore';
import type { Block, Member, SprintConfig } from '../types';

// The data layer is mocked wholesale: Supabase is unreachable from a dev
// machine and from CI, so these tests assert what the store does with the
// rows the data modules hand back.
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

const members = vi.mocked(membersDb);
const blocks = vi.mocked(blocksDb);
const sprint = vi.mocked(sprintDb);

const V1 = '2026-09-01T10:00:00.000Z';
const V2 = '2026-09-01T11:00:00.000Z';
const BOARD = 'board-1';

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

function makeSprint(overrides: Partial<SprintConfig> = {}): SprintConfig {
  return { boardId: BOARD, anchorDate: '2026-02-12', lengthDays: 14, updatedAt: V1, ...overrides };
}

/** Point the three fetches at one snapshot of the board. */
function serverHas(
  next: { members?: Member[]; blocks?: Block[]; sprint?: SprintConfig },
) {
  members.fetchMembers.mockResolvedValue(next.members ?? []);
  blocks.fetchBlocks.mockResolvedValue(next.blocks ?? []);
  sprint.fetchSprintConfig.mockResolvedValue(next.sprint ?? makeSprint());
}

const initialState = useAppStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState(initialState, true);
  useAppStore.setState({ currentBoardId: BOARD });
});

describe('reconcileBoard', () => {
  it('adds rows that appeared during the gap', async () => {
    const added = makeBlock({ id: 'b2', title: 'Spec' });
    serverHas({ members: [makeMember()], blocks: [makeBlock(), added] });

    await useAppStore.getState().reconcileBoard(BOARD);

    const state = useAppStore.getState();
    expect(state.members.map(m => m.id)).toEqual(['m1']);
    expect(state.blocks.map(b => b.id).sort()).toEqual(['b1', 'b2']);
  });

  it('takes the server version of rows that changed', async () => {
    useAppStore.setState({
      members: [makeMember()],
      blocks: [makeBlock()],
    });
    serverHas({
      members: [makeMember({ name: 'Ada L', updatedAt: V2 })],
      blocks: [makeBlock({ title: 'Design review II', updatedAt: V2 })],
      sprint: makeSprint({ anchorDate: '2026-03-05', lengthDays: 7, updatedAt: V2 }),
    });

    await useAppStore.getState().reconcileBoard(BOARD);

    const state = useAppStore.getState();
    expect(state.members[0].name).toBe('Ada L');
    expect(state.blocks[0]).toMatchObject({ title: 'Design review II', updatedAt: V2 });
    expect(state.sprintAnchorDate).toBe('2026-03-05');
    expect(state.sprintLengthDays).toBe(7);
    expect(state.sprintUpdatedAt).toBe(V2);
  });

  it('removes rows the server no longer has, and deselects a deleted block', async () => {
    useAppStore.setState({
      members: [makeMember(), makeMember({ id: 'm2', name: 'Grace' })],
      blocks: [makeBlock(), makeBlock({ id: 'b2' })],
      selectedBlockId: 'b2',
    });
    serverHas({ members: [makeMember()], blocks: [makeBlock()] });

    await useAppStore.getState().reconcileBoard(BOARD);

    const state = useAppStore.getState();
    expect(state.members.map(m => m.id)).toEqual(['m1']);
    expect(state.blocks.map(b => b.id)).toEqual(['b1']);
    expect(state.selectedBlockId).toBeNull();
  });

  it('keeps a selection that survived', async () => {
    useAppStore.setState({ blocks: [makeBlock()], selectedBlockId: 'b1' });
    serverHas({ blocks: [makeBlock({ updatedAt: V2 })] });

    await useAppStore.getState().reconcileBoard(BOARD);

    expect(useAppStore.getState().selectedBlockId).toBe('b1');
  });

  it('does not yank a block that is being dragged', async () => {
    const dragged = makeBlock({ startDate: '2026-09-20', endDate: '2026-09-22' });
    useAppStore.setState({ blocks: [dragged, makeBlock({ id: 'b2' })] });
    useAppStore.getState().lockBlock('b1');
    serverHas({
      blocks: [makeBlock({ updatedAt: V2 }), makeBlock({ id: 'b2', title: 'Moved', updatedAt: V2 })],
    });

    await useAppStore.getState().reconcileBoard(BOARD);

    const state = useAppStore.getState();
    // The locked block keeps the local (mid-gesture) dates and its pre-drag
    // version token, so commitBlock still sends the right expectedUpdatedAt.
    expect(state.blocks.find(b => b.id === 'b1')).toEqual(dragged);
    // Everything else is reconciled as usual.
    expect(state.blocks.find(b => b.id === 'b2')?.title).toBe('Moved');
  });

  it('holds on to a locked block the server has already deleted', async () => {
    const dragged = makeBlock();
    useAppStore.setState({ blocks: [dragged] });
    useAppStore.getState().lockBlock('b1');
    serverHas({ blocks: [] });

    await useAppStore.getState().reconcileBoard(BOARD);

    expect(useAppStore.getState().blocks).toEqual([dragged]);
  });

  it('ignores an answer for a board the user has already left', async () => {
    useAppStore.setState({ blocks: [makeBlock()] });
    serverHas({ blocks: [makeBlock({ id: 'b9' })] });
    blocks.fetchBlocks.mockImplementation(async () => {
      useAppStore.setState({ currentBoardId: 'board-2' });
      return [makeBlock({ id: 'b9' })];
    });

    await useAppStore.getState().reconcileBoard(BOARD);

    expect(useAppStore.getState().blocks.map(b => b.id)).toEqual(['b1']);
  });

  it('keeps what is on screen and warns when the refetch fails', async () => {
    useAppStore.setState({ members: [makeMember()], blocks: [makeBlock()] });
    members.fetchMembers.mockRejectedValue(new Error('offline'));
    blocks.fetchBlocks.mockResolvedValue([]);
    sprint.fetchSprintConfig.mockResolvedValue(makeSprint());

    await useAppStore.getState().reconcileBoard(BOARD);

    const state = useAppStore.getState();
    expect(state.blocks).toHaveLength(1);
    expect(state.toasts.map(t => t.message)).toEqual([RECONCILE_FAILED_MESSAGE]);
  });
});

describe('syncStatus', () => {
  it('starts optimistic', () => {
    expect(useAppStore.getState().syncStatus).toBe('live');
  });

  it('follows the channel while online', () => {
    useAppStore.getState().setSyncStatus('reconnecting');
    expect(useAppStore.getState().syncStatus).toBe('reconnecting');
    useAppStore.getState().setSyncStatus('live');
    expect(useAppStore.getState().syncStatus).toBe('live');
  });

  it('shows offline over anything the channel says, and restores it on reconnect', () => {
    useAppStore.getState().setSyncStatus('reconnecting');
    useAppStore.getState().setOnline(false);
    expect(useAppStore.getState().syncStatus).toBe('offline');

    // A channel callback landing while offline must not clear the banner state.
    useAppStore.getState().setSyncStatus('live');
    expect(useAppStore.getState().syncStatus).toBe('offline');

    useAppStore.getState().setOnline(true);
    expect(useAppStore.getState().syncStatus).toBe('live');
  });

  it('comes back to a dropped channel as reconnecting, not live', () => {
    useAppStore.getState().setSyncStatus('reconnecting');
    useAppStore.getState().setOnline(false);
    useAppStore.getState().setOnline(true);
    expect(useAppStore.getState().syncStatus).toBe('reconnecting');
  });
});
