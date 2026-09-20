import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';
import { useRealtimeSync, lostAccessMessage } from './useRealtimeSync';
import { useAppStore } from '../store/useAppStore';
import type { Block, Board, Member, SprintConfig } from '../types';

/**
 * A stand-in for a Supabase realtime channel whose lifecycle the test drives:
 * `emit` plays a postgres event into a table's handler, `report` plays a
 * channel status into the subscribe callback.
 */
const rt = vi.hoisted(() => {
  interface OnConfig { event: string; schema: string; table: string; filter?: string }
  interface Payload { eventType: string; new?: unknown; old?: unknown }
  interface FakeChannel {
    name: string;
    handlers: { config: OnConfig; cb: (payload: Payload) => void }[];
    status: ((status: string, err?: Error) => void) | null;
    on(event: string, config: OnConfig, cb: (payload: Payload) => void): FakeChannel;
    subscribe(cb: (status: string, err?: Error) => void): FakeChannel;
  }

  const channels: FakeChannel[] = [];
  const removeChannel = vi.fn();
  const channel = vi.fn((name: string): FakeChannel => {
    const ch: FakeChannel = {
      name,
      handlers: [],
      status: null,
      on(_event, config, cb) {
        ch.handlers.push({ config, cb });
        return ch;
      },
      subscribe(cb) {
        ch.status = cb;
        return ch;
      },
    };
    channels.push(ch);
    return ch;
  });

  return { channels, channel, removeChannel };
});

vi.mock('../lib/supabase/client', () => ({
  supabase: { channel: rt.channel, removeChannel: rt.removeChannel },
}));

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

const V1 = '2026-09-01T10:00:00.000Z';
const BOARD = 'board-1';
const USER = 'user-1';

function makeBoard(overrides: Partial<Board> = {}): Board {
  return { id: BOARD, name: 'Team', role: 'owner', updatedAt: V1, ...overrides };
}
function makeMember(overrides: Partial<Member> = {}): Member {
  return { id: 'm1', boardId: BOARD, name: 'Ada', sortOrder: 1, updatedAt: V1, ...overrides };
}
function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: 'b1', boardId: BOARD, memberId: 'm1', title: 'Spec',
    startDate: '2026-09-10', endDate: '2026-09-12', color: 'blue', tags: [], updatedAt: V1,
    ...overrides,
  };
}
function makeSprint(): SprintConfig {
  return { boardId: BOARD, anchorDate: '2026-02-12', lengthDays: 14, updatedAt: V1 };
}

/** The channel opened most recently. */
function current() {
  const ch = rt.channels[rt.channels.length - 1];
  expect(ch, 'a channel should be open').toBeTruthy();
  return ch;
}

/** Play a channel status into the newest channel's subscribe callback. */
async function report(status: string) {
  await act(async () => {
    current().status?.(status);
    await Promise.resolve();
  });
}

/** Play a postgres event into the newest channel's handler for `table`. */
async function emit(table: string, payload: { eventType: string; new?: unknown; old?: unknown }) {
  const handler = current().handlers.find(h => h.config.table === table);
  expect(handler, `a handler for "${table}" should be registered`).toBeTruthy();
  await act(async () => {
    handler!.cb(payload);
    await Promise.resolve();
  });
}

/** How many times the board contents were re-read. */
function refetchCount() {
  return members.fetchMembers.mock.calls.length;
}

const initialState = useAppStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  rt.channels.length = 0;
  vi.useFakeTimers();
  // Pin the jitter so the backoff's nominal delays are exact.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  useAppStore.setState(initialState, true);
  useAppStore.setState({
    boards: [makeBoard()],
    currentBoardId: BOARD,
    userId: USER,
    members: [makeMember()],
    blocks: [makeBlock()],
  });
  members.fetchMembers.mockResolvedValue([makeMember()]);
  blocks.fetchBlocks.mockResolvedValue([makeBlock()]);
  sprint.fetchSprintConfig.mockResolvedValue(makeSprint());
  boardsApi.fetchBoards.mockResolvedValue([makeBoard()]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useRealtimeSync subscriptions', () => {
  it('watches the board it is on and the user\'s own board list', () => {
    renderHook(() => useRealtimeSync());

    const tables = current().handlers.map(h => h.config.table);
    expect(tables).toEqual(['members', 'blocks', 'sprint_config', 'boards', 'board_members']);
    // Board rows are scoped server-side; the roster is scoped to this user.
    const byTable = Object.fromEntries(current().handlers.map(h => [h.config.table, h.config.filter]));
    expect(byTable.members).toBe(`board_id=eq.${BOARD}`);
    expect(byTable.blocks).toBe(`board_id=eq.${BOARD}`);
    expect(byTable.board_members).toBe(`user_id=eq.${USER}`);
  });

  it('merges a remote block insert', async () => {
    renderHook(() => useRealtimeSync());
    await report('SUBSCRIBED');

    await emit('blocks', {
      eventType: 'INSERT',
      new: {
        id: 'b2', board_id: BOARD, member_id: 'm1', title: 'New',
        start_date: '2026-09-14', end_date: '2026-09-15', color: 'green', updated_at: V1,
      },
    });

    expect(useAppStore.getState().blocks.map(b => b.id).sort()).toEqual(['b1', 'b2']);
  });
});

describe('useRealtimeSync connection state', () => {
  it('goes live on the first subscribe without refetching', async () => {
    renderHook(() => useRealtimeSync());
    await report('SUBSCRIBED');

    expect(useAppStore.getState().syncStatus).toBe('live');
    // The initial load just happened; nothing was missed yet.
    expect(refetchCount()).toBe(0);
  });

  it.each(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'])('reports %s as reconnecting', async (status) => {
    renderHook(() => useRealtimeSync());
    await report('SUBSCRIBED');
    await report(status);

    expect(useAppStore.getState().syncStatus).toBe('reconnecting');
  });

  it('stays offline while the browser has no network', async () => {
    renderHook(() => useRealtimeSync());
    act(() => useAppStore.getState().setOnline(false));
    await report('SUBSCRIBED');

    expect(useAppStore.getState().syncStatus).toBe('offline');
  });
});

describe('useRealtimeSync backoff', () => {
  it('re-subscribes a dropped channel after one second', async () => {
    renderHook(() => useRealtimeSync());
    await report('SUBSCRIBED');
    await report('CHANNEL_ERROR');

    expect(rt.channels).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    expect(rt.channels).toHaveLength(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rt.channels).toHaveLength(2);
    // The dead channel is disposed of rather than re-used.
    expect(rt.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('doubles the delay while the outage lasts, and resets once it is back', async () => {
    renderHook(() => useRealtimeSync());
    await report('SUBSCRIBED');

    const delays = [1000, 2000, 4000];
    for (const [i, delay] of delays.entries()) {
      await report('CHANNEL_ERROR');
      await act(async () => { await vi.advanceTimersByTimeAsync(delay - 1); });
      expect(rt.channels).toHaveLength(i + 1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(rt.channels).toHaveLength(i + 2);
    }

    // A good connection clears the exponent: the next drop waits 1s again.
    await report('SUBSCRIBED');
    await report('CHANNEL_ERROR');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(rt.channels).toHaveLength(delays.length + 2);
  });

  it('only schedules one retry per drop', async () => {
    renderHook(() => useRealtimeSync());
    await report('SUBSCRIBED');
    await report('CHANNEL_ERROR');
    await report('TIMED_OUT');
    await report('CLOSED');

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(rt.channels).toHaveLength(2);
  });
});

describe('useRealtimeSync gap recovery', () => {
  it('re-reads the board once when the channel comes back', async () => {
    renderHook(() => useRealtimeSync());
    await report('SUBSCRIBED');
    await report('CHANNEL_ERROR');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await report('SUBSCRIBED');

    expect(useAppStore.getState().syncStatus).toBe('live');
    expect(members.fetchMembers).toHaveBeenCalledTimes(1);
    expect(blocks.fetchBlocks).toHaveBeenCalledTimes(1);
    expect(sprint.fetchSprintConfig).toHaveBeenCalledTimes(1);
    expect(members.fetchMembers).toHaveBeenCalledWith(BOARD);

    // A repeat SUBSCRIBED without a drop in between is not another gap.
    await report('SUBSCRIBED');
    expect(refetchCount()).toBe(1);
  });

  it('applies what it missed', async () => {
    renderHook(() => useRealtimeSync());
    await report('SUBSCRIBED');
    members.fetchMembers.mockResolvedValue([makeMember({ name: 'Ada L' })]);
    blocks.fetchBlocks.mockResolvedValue([makeBlock({ id: 'b2', title: 'Added while away' })]);

    await report('CHANNEL_ERROR');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await report('SUBSCRIBED');

    const state = useAppStore.getState();
    expect(state.members[0].name).toBe('Ada L');
    expect(state.blocks.map(b => b.title)).toEqual(['Added while away']);
  });

  it('re-reads after a long spell in the background', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    renderHook(() => useRealtimeSync());
    await report('SUBSCRIBED');

    visibility.mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    visibility.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    expect(refetchCount()).toBe(1);
  });

  it('does not re-read after a glance away', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    renderHook(() => useRealtimeSync());
    await report('SUBSCRIBED');

    visibility.mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    visibility.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    expect(refetchCount()).toBe(0);
  });
});

describe('useRealtimeSync board list', () => {
  it('picks up a board that was just shared with the user', async () => {
    renderHook(() => useRealtimeSync());
    await report('SUBSCRIBED');
    const shared = makeBoard({ id: 'board-2', name: 'Platform' });
    boardsApi.fetchBoards.mockResolvedValue([makeBoard(), shared]);

    await emit('board_members', { eventType: 'INSERT', new: { user_id: USER } });

    expect(useAppStore.getState().boards.map(b => b.name)).toEqual(['Team', 'Platform']);
    // Still where the user was; nothing was taken away.
    expect(useAppStore.getState().currentBoardId).toBe(BOARD);
    expect(useAppStore.getState().toasts).toHaveLength(0);
  });

  it('moves to another board when access to this one is revoked', async () => {
    const other = makeBoard({ id: 'board-2', name: 'Platform' });
    useAppStore.setState({ boards: [makeBoard(), other] });
    renderHook(() => useRealtimeSync());
    await report('SUBSCRIBED');
    boardsApi.fetchBoards.mockResolvedValue([other]);

    await emit('board_members', { eventType: 'DELETE', old: { user_id: USER } });

    const state = useAppStore.getState();
    expect(state.currentBoardId).toBe('board-2');
    expect(state.toasts.map(t => t.message)).toEqual([lostAccessMessage('Team')]);
  });

  it('falls back to the first-run screen when the last board goes', async () => {
    renderHook(() => useRealtimeSync());
    await report('SUBSCRIBED');
    boardsApi.fetchBoards.mockResolvedValue([]);

    await emit('boards', { eventType: 'DELETE', old: { id: BOARD } });

    const state = useAppStore.getState();
    expect(state.currentBoardId).toBeNull();
    expect(state.members).toEqual([]);
    expect(state.blocks).toEqual([]);
    expect(state.toasts.map(t => t.message)).toEqual([lostAccessMessage('Team')]);
  });
});

describe('useRealtimeSync teardown', () => {
  it('removes the channel and drops any pending retry on unmount', async () => {
    const { unmount } = renderHook(() => useRealtimeSync());
    await report('SUBSCRIBED');
    await report('CHANNEL_ERROR');

    unmount();

    expect(rt.removeChannel).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    // No resubscribe, and nothing refetched, after the component is gone.
    expect(rt.channels).toHaveLength(1);
    expect(refetchCount()).toBe(0);
  });

  it('re-opens on a different board and lets the old channel go', async () => {
    const { rerender } = renderHook(() => useRealtimeSync());
    await report('SUBSCRIBED');

    await act(async () => {
      useAppStore.setState({ currentBoardId: 'board-2' });
      rerender();
    });

    expect(rt.removeChannel).toHaveBeenCalledTimes(1);
    expect(rt.channels).toHaveLength(2);
    expect(current().name).toBe('db-changes:board-2');
  });
});
