import { create } from 'zustand';
import type { Block, BlockDraft, Board, Member, ContextMenuState, SprintConfig, Toast, ToastAction, ZoomLevel } from '../types';
import { isoToday, addDaysToISO } from '../lib/dates';
import { ZOOM_DAY_WIDTH } from '../lib/layout';
import { fetchMembers, fetchMember, insertMember, updateMemberName, updateMemberSortOrder, deleteMember as deleteMemberDb } from '../lib/supabase/members';
import { fetchBlocks, fetchBlock, insertBlock, updateBlockFields, deleteBlockById } from '../lib/supabase/blocks';
import { fetchSprintConfig, updateSprintConfigFields } from '../lib/supabase/sprintConfig';
import {
  fetchBoards,
  createBoard as createBoardDb,
  renameBoard as renameBoardDb,
  deleteBoard as deleteBoardDb,
} from '../lib/supabase/boards';
import { isConflictError } from '../lib/supabase/errors';
import { addBreadcrumb } from '../lib/errorReporter';
import { pushUndo, clearUndo } from './undo';

/**
 * How fresh what is on screen is.
 *
 * `live` — subscribed, edits from other people arrive as they happen.
 * `reconnecting` — the subscription dropped and is being re-opened; the board
 *   may be missing changes until it comes back.
 * `offline` — the browser has no network at all (writes are refused too).
 */
export type SyncStatus = 'live' | 'reconnecting' | 'offline';
import { tagsMatch } from '../lib/tags';

interface AppStore {
  // Boards — one deployment hosts many teams; everything below belongs to
  // whichever board is current.
  boards: Board[];
  currentBoardId: string | null;

  // Data state (populated from Supabase)
  members: Member[];
  blocks: Block[];
  sprintAnchorDate: string;
  sprintLengthDays: number;
  /** Version token for the sprint_config row (see Block.updatedAt). */
  sprintUpdatedAt: string;

  // UI state
  selectedBlockId: string | null;
  contextMenu: ContextMenuState | null;
  isModalOpen: boolean;
  isSettingsOpen: boolean;
  isBoardSettingsOpen: boolean;
  /** The keyboard cheat sheet (opened with `?`). */
  isShortcutsOpen: boolean;
  editingBlockId: string | null;
  draggingBlockId: string | null;
  newBlockId: string | null;
  draftBlock: BlockDraft | null;
  renderStartDate: string;
  renderEndDate: string;
  isOnline: boolean;
  /** What the status pill shows: the channel's state, forced to `offline` when the browser is. */
  syncStatus: SyncStatus;
  /**
   * What the realtime layer last reported, ignoring `isOnline`. Kept so that
   * coming back online restores the connection's real state instead of
   * guessing at it.
   */
  channelStatus: 'live' | 'reconnecting';
  toasts: Toast[];
  lockedBlockIds: Set<string>;
  userId: string | null;
  zoom: ZoomLevel;
  /** Derived from `zoom` — kept in sync by `setZoom` so components can select it directly */
  dayWidth: number;
  /** Capacity view: per-sprint committed vs available days on the board. */
  capacityEnabled: boolean;
  /**
   * Tags the filter bar is currently narrowing to (OR semantics; empty means
   * "show everything"). Deliberately not persisted: a filter is a way of
   * looking at the board right now, not a setting, so a reload and a board
   * switch both start from the unfiltered view.
   */
  activeTags: string[];

  // Board actions
  setBoards: (boards: Board[]) => void;
  /** Switches board: persists the choice and clears the previous board's data. */
  setCurrentBoard: (id: string) => void;
  createBoard: (name: string) => void;
  renameBoard: (id: string, name: string) => void;
  deleteBoard: (id: string) => void;

  // Bulk setters (for initial load + realtime)
  setMembers: (members: Member[]) => void;
  setBlocks: (blocks: Block[]) => void;
  setSprintConfig: (config: SprintConfig) => void;
  setUserId: (id: string) => void;

  // Remote merge actions (for realtime)
  mergeRemoteMember: (member: Member) => void;
  mergeRemoteBlock: (block: Block) => void;
  removeRemoteMember: (id: string) => void;
  removeRemoteBlock: (id: string) => void;

  // Member actions (optimistic + Supabase)
  addMember: (name: string) => void;
  removeMember: (id: string) => void;
  renameMember: (id: string, name: string) => void;
  moveMember: (id: string, newSortOrder: number) => void;

  // Block actions (optimistic + Supabase)
  addBlock: (block: BlockDraft) => void;
  updateBlock: (id: string, patch: Partial<Omit<Block, 'id' | 'boardId' | 'updatedAt'>>) => void;
  deleteBlock: (id: string) => void;
  duplicateBlock: (id: string) => void;
  commitBlock: (id: string) => void;

  // Sprint settings
  updateSprintSettings: (anchor: string, length: number) => void;

  // UI actions
  setSelectedBlock: (id: string | null) => void;
  setContextMenu: (menu: ContextMenuState | null) => void;
  setDraggingBlock: (id: string | null) => void;
  openEditModal: (blockId: string) => void;
  openNewBlockModal: (block: BlockDraft) => void;
  closeModal: () => void;
  setSettingsOpen: (open: boolean) => void;
  setBoardSettingsOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  expandTimelineBefore: (days: number) => void;
  expandTimelineAfter: (days: number) => void;
  setZoom: (zoom: ZoomLevel) => void;
  setCapacityEnabled: (enabled: boolean) => void;

  // Tag filter
  toggleTag: (tag: string) => void;
  clearTags: () => void;

  // Online/offline
  setOnline: (online: boolean) => void;
  /** Reports the realtime channel's state; the offline override is applied here. */
  setSyncStatus: (status: SyncStatus) => void;
  /**
   * Re-reads a board and reconciles the store with it — the recovery path for
   * every gap in the realtime stream (reconnect, tab wake, coming back online).
   */
  reconcileBoard: (boardId: string) => Promise<void>;

  // Toast actions
  addToast: (message: string, type?: 'error' | 'info', action?: ToastAction) => void;
  dismissToast: (id: string) => void;

  // Lock management (for realtime conflict prevention)
  lockBlock: (id: string) => void;
  unlockBlock: (id: string) => void;
}

const today = isoToday();

// --- Conflict handling ---------------------------------------------------
//
// Every write is conditional on the `updatedAt` the client last saw. When the
// server rejects one, rolling back to our stale copy would hide the other
// person's edit, so instead we re-read the row, show their version, and say so.

export const CONFLICT_BLOCK_MESSAGE = 'Someone else changed this block; showing their version';
export const CONFLICT_MEMBER_MESSAGE = 'Someone else changed this member; showing their version';
export const CONFLICT_SPRINT_MESSAGE = 'Someone else changed the sprint settings; showing their version';
export const CONFLICT_BOARD_MESSAGE = 'Someone else changed this board; showing their version';

/** Shown when the post-gap refetch (`reconcileBoard`) cannot reach the server. */
export const RECONCILE_FAILED_MESSAGE = 'Failed to refresh data after reconnect';

/** Re-read a block after a rejected write and merge the server's version in. */
async function resolveBlockConflict(id: string) {
  try {
    const fresh = await fetchBlock(id);
    const store = useAppStore.getState();
    if (!fresh) {
      store.removeRemoteBlock(id);
    } else if (!store.lockedBlockIds.has(id)) {
      // A locked block is mid-drag; don't yank it out from under the pointer.
      store.mergeRemoteBlock(fresh);
    }
  } catch {
    // Refetch failed (offline, RLS, ...) — keep what we have; the toast warns.
  }
  useAppStore.getState().addToast(CONFLICT_BLOCK_MESSAGE, 'error');
}

/** Re-read a member after a rejected write and merge the server's version in. */
async function resolveMemberConflict(id: string) {
  try {
    const fresh = await fetchMember(id);
    const store = useAppStore.getState();
    if (fresh) store.mergeRemoteMember(fresh);
    else store.removeRemoteMember(id);
  } catch {
    // Keep what we have; the toast warns.
  }
  useAppStore.getState().addToast(CONFLICT_MEMBER_MESSAGE, 'error');
}

/** Re-read the sprint config after a rejected write. */
async function resolveSprintConflict(boardId: string) {
  try {
    const fresh = await fetchSprintConfig(boardId);
    useAppStore.getState().setSprintConfig(fresh);
  } catch {
    // Keep what we have; the toast warns.
  }
  useAppStore.getState().addToast(CONFLICT_SPRINT_MESSAGE, 'error');
}

/** Re-read the board list after a rejected rename. */
async function resolveBoardConflict() {
  try {
    const fresh = await fetchBoards();
    useAppStore.getState().setBoards(fresh);
  } catch {
    // Keep what we have; the toast warns.
  }
  useAppStore.getState().addToast(CONFLICT_BOARD_MESSAGE, 'error');
}

const ZOOM_STORAGE_KEY = 'swimlanes.zoom';
const BOARD_STORAGE_KEY = 'swimlanes.board';
const CAPACITY_STORAGE_KEY = 'swimlanes.capacity';

/** The board this browser was last looking at, if any. */
function loadCurrentBoardId(): string | null {
  try {
    return localStorage.getItem(BOARD_STORAGE_KEY);
  } catch {
    // localStorage can throw in private mode / sandboxed frames — ignore
    return null;
  }
}

function saveCurrentBoardId(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(BOARD_STORAGE_KEY);
    else localStorage.setItem(BOARD_STORAGE_KEY, id);
  } catch {
    // Persistence is best-effort
  }
}

function isZoomLevel(value: unknown): value is ZoomLevel {
  return value === 'day' || value === 'week' || value === 'quarter';
}

/** Read the persisted zoom level; falls back to 'day' when storage is unavailable */
function loadZoom(): ZoomLevel {
  try {
    const raw = localStorage.getItem(ZOOM_STORAGE_KEY);
    if (isZoomLevel(raw)) return raw;
  } catch {
    // localStorage can throw in private mode / sandboxed frames — ignore
  }
  return 'day';
}

function saveZoom(zoom: ZoomLevel): void {
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, zoom);
  } catch {
    // Persistence is best-effort
  }
}

/** The capacity view is off unless this browser last left it on. */
function loadCapacityEnabled(): boolean {
  try {
    return localStorage.getItem(CAPACITY_STORAGE_KEY) === 'true';
  } catch {
    // localStorage can throw in private mode / sandboxed frames — ignore
    return false;
  }
}

function saveCapacityEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(CAPACITY_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Persistence is best-effort
  }
}

const initialZoom = loadZoom();

// --- Undo bookkeeping ----------------------------------------------------
//
// Every reversible action records a step on the undo stack (src/store/undo.ts)
// whose halves call back into these same actions, so an undone edit persists
// and resolves conflicts like any other edit.

type BlockPatch = Partial<Omit<Block, 'id' | 'boardId' | 'updatedAt'>>;

/** Drop the board stamp so a block can be re-inserted through `addBlock`. */
function toDraft(block: Block): BlockDraft {
  // Copy-and-delete rather than destructure, so fields added to Block later
  // are carried into the draft without touching this function.
  const draft: Partial<Block> = { ...block };
  delete draft.boardId;
  return draft as BlockDraft;
}

/** The values `patch` is about to overwrite — the patch that puts them back. */
function inversePatch(block: Block, patch: BlockPatch): BlockPatch {
  const before: Record<string, unknown> = {};
  const current = block as unknown as Record<string, unknown>;
  for (const key of Object.keys(patch)) before[key] = current[key];
  return before as BlockPatch;
}

/** A human label for the undo toast, from the fields the patch touches. */
function describeBlockPatch(patch: BlockPatch): string {
  const keys = Object.keys(patch);
  if (keys.length === 1) {
    switch (keys[0]) {
      case 'title': return 'Rename block';
      case 'color': return 'Recolor block';
      case 'memberId': return 'Move block';
      case 'startDate':
      case 'endDate': return 'Resize block';
    }
  }
  if (keys.length === 2 && 'startDate' in patch && 'endDate' in patch) return 'Move block';
  return 'Edit block';
}

/**
 * Dates a block had when it was locked for a drag, resize or keyboard nudge.
 * `commitBlock` turns the difference into one undo step for the whole gesture,
 * instead of one per pointermove.
 */
const lockSnapshots = new Map<string, { startDate: string; endDate: string }>();

export const useAppStore = create<AppStore>()((set, get) => ({
  // Boards — empty until DataLoader populates
  boards: [],
  currentBoardId: loadCurrentBoardId(),

  // Data state — empty until DataLoader populates
  members: [],
  blocks: [],
  sprintAnchorDate: '2026-02-12',
  sprintLengthDays: 14,
  sprintUpdatedAt: '',

  // UI state
  selectedBlockId: null,
  contextMenu: null,
  isModalOpen: false,
  isSettingsOpen: false,
  isBoardSettingsOpen: false,
  isShortcutsOpen: false,
  editingBlockId: null,
  draggingBlockId: null,
  newBlockId: null,
  draftBlock: null,
  renderStartDate: addDaysToISO(today, -14),
  renderEndDate: addDaysToISO(today, 90),
  isOnline: true,
  // Optimistic like `isOnline`: assume the connection is good until something
  // says otherwise, so a healthy start never flashes "Reconnecting".
  syncStatus: 'live',
  channelStatus: 'live',
  toasts: [],
  lockedBlockIds: new Set<string>(),
  userId: null,
  zoom: initialZoom,
  dayWidth: ZOOM_DAY_WIDTH[initialZoom],
  capacityEnabled: loadCapacityEnabled(),
  activeTags: [],

  // --- Board actions ---

  setBoards: (boards) => set({ boards }),

  setCurrentBoard: (id) => {
    if (get().currentBoardId === id) return;
    saveCurrentBoardId(id);
    // The stack holds closures over rows of the board being left behind.
    clearUndo();
    // Drop the previous board's rows immediately so nothing from the old team
    // is ever on screen; DataLoader refetches for the new board.
    // The tag filter belongs to the board it was set on, so it goes too.
    set({ currentBoardId: id, members: [], blocks: [], selectedBlockId: null, activeTags: [] });
  },

  createBoard: (name) => {
    if (!get().isOnline) {
      get().addToast('Cannot save while offline', 'error');
      return;
    }
    const previousBoardId = get().currentBoardId;
    // The id is generated here so the optimistic row and the server row are
    // the same board — switching to it does not have to wait for the insert.
    const optimistic: Board = {
      id: crypto.randomUUID(),
      name,
      role: 'owner',
      // Provisional until the insert comes back with the server's value.
      updatedAt: new Date().toISOString(),
    };
    set(state => ({ boards: [...state.boards, optimistic] }));
    get().setCurrentBoard(optimistic.id);

    createBoardDb(name, optimistic.id).then(board => {
      set(state => ({
        boards: state.boards.map(b => (b.id === optimistic.id ? board : b)),
      }));
    }).catch(() => {
      set(state => ({ boards: state.boards.filter(b => b.id !== optimistic.id) }));
      if (previousBoardId) get().setCurrentBoard(previousBoardId);
      else set({ currentBoardId: null });
      get().addToast('Failed to create board', 'error');
    });
  },

  renameBoard: (id, name) => {
    if (!get().isOnline) {
      get().addToast('Cannot save while offline', 'error');
      return;
    }
    const prevBoards = get().boards;
    const expectedUpdatedAt = prevBoards.find(b => b.id === id)?.updatedAt;
    if (expectedUpdatedAt === undefined) return;
    set(state => ({
      boards: state.boards.map(b => (b.id === id ? { ...b, name } : b)),
    }));

    renameBoardDb(id, name, expectedUpdatedAt).then(updatedAt => {
      set(state => ({
        boards: state.boards.map(b => (b.id === id ? { ...b, updatedAt } : b)),
      }));
    }).catch(error => {
      if (isConflictError(error)) {
        void resolveBoardConflict();
        return;
      }
      set({ boards: prevBoards });
      get().addToast('Failed to rename board', 'error');
    });
  },

  deleteBoard: (id) => {
    if (!get().isOnline) {
      get().addToast('Cannot save while offline', 'error');
      return;
    }
    const prevBoards = get().boards;
    const prevBoardId = get().currentBoardId;
    // Refuse to leave the user with nowhere to go.
    if (prevBoards.length <= 1) {
      get().addToast('You cannot delete your only board', 'error');
      return;
    }
    const remaining = prevBoards.filter(b => b.id !== id);
    set({ boards: remaining, isBoardSettingsOpen: false });
    if (prevBoardId === id) {
      set({ currentBoardId: null });
      get().setCurrentBoard(remaining[0].id);
    }

    deleteBoardDb(id).catch(() => {
      set({ boards: prevBoards });
      if (prevBoardId && prevBoardId !== get().currentBoardId) {
        get().setCurrentBoard(prevBoardId);
      }
      get().addToast('Failed to delete board', 'error');
    });
  },

  // Bulk setters
  setMembers: (members) => set({ members }),
  setBlocks: (blocks) => set({ blocks }),
  setSprintConfig: (config) => set({
    sprintAnchorDate: config.anchorDate,
    sprintLengthDays: config.lengthDays,
    sprintUpdatedAt: config.updatedAt,
  }),
  setUserId: (id) => set({ userId: id }),

  // Remote merge actions (for realtime sync)
  mergeRemoteMember: (member) => set(state => {
    const idx = state.members.findIndex(m => m.id === member.id);
    if (idx >= 0) {
      const updated = [...state.members];
      updated[idx] = member;
      return { members: updated };
    }
    return { members: [...state.members, member] };
  }),

  mergeRemoteBlock: (block) => set(state => {
    const idx = state.blocks.findIndex(b => b.id === block.id);
    if (idx >= 0) {
      const updated = [...state.blocks];
      updated[idx] = block;
      return { blocks: updated };
    }
    return { blocks: [...state.blocks, block] };
  }),

  removeRemoteMember: (id) => set(state => ({
    members: state.members.filter(m => m.id !== id),
    blocks: state.blocks.filter(b => b.memberId !== id),
  })),

  removeRemoteBlock: (id) => set(state => ({
    blocks: state.blocks.filter(b => b.id !== id),
    selectedBlockId: state.selectedBlockId === id ? null : state.selectedBlockId,
  })),

  // --- Member actions (optimistic + Supabase) ---

  addMember: (name) => {
    if (!get().isOnline) {
      get().addToast('Cannot save while offline', 'error');
      return;
    }
    addBreadcrumb('add member');
    const state = get();
    const boardId = state.currentBoardId;
    if (!boardId) return;
    const maxSort = state.members.length > 0
      ? Math.max(...state.members.map(m => m.sortOrder))
      : 0;
    const newMember: Member = {
      id: crypto.randomUUID(),
      boardId,
      name,
      sortOrder: maxSort + 1,
      // Provisional until the insert comes back with the server's value.
      updatedAt: new Date().toISOString(),
    };
    set({ members: [...state.members, newMember] });

    const userId = state.userId;
    if (userId) {
      insertMember(newMember, userId).then(updatedAt => {
        set(s => ({
          members: s.members.map(m => (m.id === newMember.id ? { ...m, updatedAt } : m)),
        }));
      }).catch(() => {
        set({ members: get().members.filter(m => m.id !== newMember.id) });
        get().addToast('Failed to add member', 'error');
      });
    }
  },

  removeMember: (id) => {
    if (!get().isOnline) {
      get().addToast('Cannot save while offline', 'error');
      return;
    }
    addBreadcrumb('remove member');
    const prevMembers = get().members;
    const prevBlocks = get().blocks;
    set(state => ({
      members: state.members.filter(m => m.id !== id),
      blocks: state.blocks.filter(b => b.memberId !== id),
    }));

    deleteMemberDb(id).catch(() => {
      set({ members: prevMembers, blocks: prevBlocks });
      get().addToast('Failed to remove member', 'error');
    });
  },

  renameMember: (id, name) => {
    if (!get().isOnline) {
      get().addToast('Cannot save while offline', 'error');
      return;
    }
    const prevMembers = get().members;
    const previous = prevMembers.find(m => m.id === id);
    const expectedUpdatedAt = previous?.updatedAt;
    if (previous === undefined || expectedUpdatedAt === undefined) return;
    addBreadcrumb('rename member');
    set(state => ({
      members: state.members.map(m =>
        m.id === id ? { ...m, name } : m
      ),
    }));
    const prevName = previous.name;
    pushUndo({
      label: 'Rename member',
      undo: () => get().renameMember(id, prevName),
      redo: () => get().renameMember(id, name),
    });

    updateMemberName(id, name, expectedUpdatedAt).then(updatedAt => {
      set(state => ({
        members: state.members.map(m => (m.id === id ? { ...m, updatedAt } : m)),
      }));
    }).catch(error => {
      if (isConflictError(error)) {
        void resolveMemberConflict(id);
        return;
      }
      set({ members: prevMembers });
      get().addToast('Failed to rename member', 'error');
    });
  },

  moveMember: (id, newSortOrder) => {
    if (!get().isOnline) {
      get().addToast('Cannot save while offline', 'error');
      return;
    }
    const prevMembers = get().members;
    const previous = prevMembers.find(m => m.id === id);
    const expectedUpdatedAt = previous?.updatedAt;
    if (previous === undefined || expectedUpdatedAt === undefined) return;
    set(state => ({
      members: state.members.map(m =>
        m.id === id ? { ...m, sortOrder: newSortOrder } : m
      ),
    }));
    const prevSortOrder = previous.sortOrder;
    pushUndo({
      label: 'Reorder member',
      undo: () => get().moveMember(id, prevSortOrder),
      redo: () => get().moveMember(id, newSortOrder),
    });

    updateMemberSortOrder(id, newSortOrder, expectedUpdatedAt).then(updatedAt => {
      set(state => ({
        members: state.members.map(m => (m.id === id ? { ...m, updatedAt } : m)),
      }));
    }).catch(error => {
      if (isConflictError(error)) {
        void resolveMemberConflict(id);
        return;
      }
      set({ members: prevMembers });
      get().addToast('Failed to reorder member', 'error');
    });
  },

  // --- Block actions (optimistic + Supabase) ---

  addBlock: (draft) => {
    if (!get().isOnline) {
      get().addToast('Cannot save while offline', 'error');
      return;
    }
    addBreadcrumb('add block');
    const boardId = get().currentBoardId;
    if (!boardId) return;
    // The draft comes from the timeline, which does not know about boards;
    // stamping it here keeps every insert on the board that is on screen.
    const block: Block = { ...draft, boardId };
    set(state => ({
      blocks: [...state.blocks, block],
    }));
    pushUndo({
      label: 'Add block',
      undo: () => get().deleteBlock(block.id),
      // The draft carries its id, so a redo restores the very same block.
      redo: () => get().addBlock(draft),
    });

    const userId = get().userId;
    if (userId) {
      insertBlock(block, userId).then(updatedAt => {
        set(state => ({
          blocks: state.blocks.map(b => (b.id === block.id ? { ...b, updatedAt } : b)),
        }));
      }).catch(() => {
        set(state => ({
          blocks: state.blocks.filter(b => b.id !== block.id),
        }));
        get().addToast('Failed to add block', 'error');
      });
    }
  },

  updateBlock: (id, patch) => {
    // Don't fire Supabase during drag/resize — commitBlock handles that
    // Still allow the optimistic update so the block moves visually.
    // `updatedAt` is deliberately left alone: commitBlock at drag end must
    // send the version the block had before the drag started.
    if (get().lockedBlockIds.has(id)) {
      set(state => ({
        blocks: state.blocks.map(b =>
          b.id === id ? { ...b, ...patch } : b
        ),
      }));
      return;
    }

    if (!get().isOnline) {
      get().addToast('Cannot save while offline', 'error');
      return;
    }

    const prevBlocks = get().blocks;
    const previous = prevBlocks.find(b => b.id === id);
    const expectedUpdatedAt = previous?.updatedAt;
    if (previous === undefined || expectedUpdatedAt === undefined) return;
    addBreadcrumb('update block');
    set(state => ({
      blocks: state.blocks.map(b =>
        b.id === id ? { ...b, ...patch } : b
      ),
    }));
    const before = inversePatch(previous, patch);
    pushUndo({
      label: describeBlockPatch(patch),
      undo: () => get().updateBlock(id, before),
      redo: () => get().updateBlock(id, patch),
    });

    updateBlockFields(id, patch, expectedUpdatedAt).then(updatedAt => {
      set(state => ({
        blocks: state.blocks.map(b => (b.id === id ? { ...b, updatedAt } : b)),
      }));
    }).catch(error => {
      if (isConflictError(error)) {
        void resolveBlockConflict(id);
        return;
      }
      set({ blocks: prevBlocks });
      get().addToast('Failed to save block changes', 'error');
    });
  },

  deleteBlock: (id) => {
    if (!get().isOnline) {
      get().addToast('Cannot save while offline', 'error');
      return;
    }
    const prevBlocks = get().blocks;
    const removed = prevBlocks.find(b => b.id === id);
    addBreadcrumb('delete block');
    set(state => ({
      blocks: state.blocks.filter(b => b.id !== id),
      selectedBlockId: state.selectedBlockId === id ? null : state.selectedBlockId,
      contextMenu: null,
    }));
    if (removed) {
      const draft = toDraft(removed);
      pushUndo({
        label: 'Delete block',
        // Re-inserted with the same id, so anything referring to it still works.
        undo: () => get().addBlock(draft),
        redo: () => get().deleteBlock(id),
      });
    }

    // Deletes are unconditional: removing a block someone else just edited is
    // fine, and deleting an already-deleted row resolves without a toast.
    deleteBlockById(id).catch(() => {
      set({ blocks: prevBlocks });
      get().addToast('Failed to delete block', 'error');
    });
  },

  duplicateBlock: (id) => {
    if (!get().isOnline) {
      get().addToast('Cannot save while offline', 'error');
      return;
    }
    const original = get().blocks.find(b => b.id === id);
    if (!original) return;
    const boardId = get().currentBoardId;
    if (!boardId) return;
    const newBlock: Block = {
      ...original,
      id: crypto.randomUUID(),
      boardId,
      title: `${original.title} (copy)`,
      startDate: addDaysToISO(original.startDate, 1),
      endDate: addDaysToISO(original.endDate, 1),
      // Provisional until the insert comes back with the server's value.
      updatedAt: new Date().toISOString(),
    };
    set(state => ({
      blocks: [...state.blocks, newBlock],
      contextMenu: null,
    }));
    pushUndo({
      label: 'Duplicate block',
      undo: () => get().deleteBlock(newBlock.id),
      redo: () => get().addBlock(toDraft(newBlock)),
    });

    const userId = get().userId;
    if (userId) {
      insertBlock(newBlock, userId).then(updatedAt => {
        set(state => ({
          blocks: state.blocks.map(b => (b.id === newBlock.id ? { ...b, updatedAt } : b)),
        }));
      }).catch(() => {
        set(state => ({
          blocks: state.blocks.filter(b => b.id !== newBlock.id),
        }));
        get().addToast('Failed to duplicate block', 'error');
      });
    }
  },

  commitBlock: (id) => {
    if (!get().isOnline) {
      get().addToast('Cannot save while offline', 'error');
      return;
    }
    const block = get().blocks.find(b => b.id === id);
    if (!block) return;
    // One undo step for the whole gesture: the dates from when the block was
    // locked back to the dates it is being committed with.
    const before = lockSnapshots.get(id);
    lockSnapshots.delete(id);
    if (before && (before.startDate !== block.startDate || before.endDate !== block.endDate)) {
      const after = { startDate: block.startDate, endDate: block.endDate };
      const moved = before.startDate !== block.startDate && before.endDate !== block.endDate;
      pushUndo({
        label: moved ? 'Move block' : 'Resize block',
        undo: () => get().updateBlock(id, before),
        redo: () => get().updateBlock(id, after),
      });
    }
    // `block.updatedAt` is the version from before the drag: optimistic moves
    // while locked never touch it, and realtime skips locked blocks.
    updateBlockFields(id, {
      startDate: block.startDate,
      endDate: block.endDate,
    }, block.updatedAt).then(updatedAt => {
      set(state => ({
        blocks: state.blocks.map(b => (b.id === id ? { ...b, updatedAt } : b)),
      }));
    }).catch(error => {
      if (isConflictError(error)) {
        void resolveBlockConflict(id);
        return;
      }
      get().addToast('Failed to save block position', 'error');
    });
  },

  // Sprint settings
  updateSprintSettings: (anchor, length) => {
    if (!get().isOnline) {
      get().addToast('Cannot save while offline', 'error');
      return;
    }
    const boardId = get().currentBoardId;
    if (!boardId) return;
    const prevAnchor = get().sprintAnchorDate;
    const prevLength = get().sprintLengthDays;
    const expectedUpdatedAt = get().sprintUpdatedAt;
    addBreadcrumb('update sprint settings');
    set({
      sprintAnchorDate: anchor,
      sprintLengthDays: length,
    });

    updateSprintConfigFields(boardId, anchor, length, expectedUpdatedAt).then(updatedAt => {
      set({ sprintUpdatedAt: updatedAt });
    }).catch(error => {
      if (isConflictError(error)) {
        void resolveSprintConflict(boardId);
        return;
      }
      set({ sprintAnchorDate: prevAnchor, sprintLengthDays: prevLength });
      get().addToast('Failed to save sprint settings', 'error');
    });
  },

  // UI actions
  setSelectedBlock: (id) => set({ selectedBlockId: id }),
  setContextMenu: (menu) => set({ contextMenu: menu }),
  setDraggingBlock: (id) => set({ draggingBlockId: id }),

  openEditModal: (blockId) => set({
    editingBlockId: blockId,
    isModalOpen: true,
    contextMenu: null,
  }),

  openNewBlockModal: (block) => set({
    draftBlock: block,
    newBlockId: block.id,
    editingBlockId: block.id,
    isModalOpen: true,
  }),

  closeModal: () => set({
    isModalOpen: false,
    editingBlockId: null,
    newBlockId: null,
    draftBlock: null,
  }),

  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
  setBoardSettingsOpen: (open) => set({ isBoardSettingsOpen: open }),
  setShortcutsOpen: (open) => set({ isShortcutsOpen: open }),

  expandTimelineBefore: (days) => set(state => ({
    renderStartDate: addDaysToISO(state.renderStartDate, -days),
  })),

  expandTimelineAfter: (days) => set(state => ({
    renderEndDate: addDaysToISO(state.renderEndDate, days),
  })),

  setZoom: (zoom) => {
    if (get().zoom === zoom) return;
    saveZoom(zoom);
    set({ zoom, dayWidth: ZOOM_DAY_WIDTH[zoom] });
  },

  setCapacityEnabled: (enabled) => {
    if (get().capacityEnabled === enabled) return;
    saveCapacityEnabled(enabled);
    set({ capacityEnabled: enabled });
  },
  // Tag filter — case-insensitive, so toggling "Infra" clears "infra" too.
  toggleTag: (tag) => set(state => {
    const trimmed = tag.trim();
    if (!trimmed) return {};
    const without = state.activeTags.filter(t => !tagsMatch(t, trimmed));
    return {
      activeTags: without.length === state.activeTags.length
        ? [...state.activeTags, trimmed]
        : without,
    };
  }),

  clearTags: () => set({ activeTags: [] }),

  // Online/offline
  setOnline: (online) => {
    addBreadcrumb(online ? 'online' : 'offline');
    // With no network there is nothing to be live about, whatever the channel
    // last said; coming back restores the channel's own view of itself.
    set(state => ({
      isOnline: online,
      syncStatus: online ? state.channelStatus : 'offline',
    }));
  },

  setSyncStatus: (status) => {
    if (status === 'offline') {
      set({ syncStatus: 'offline' });
      return;
    }
    set(state => ({
      channelStatus: status,
      syncStatus: state.isOnline ? status : 'offline',
    }));
  },

  reconcileBoard: async (boardId) => {
    let fresh: [Member[], Block[], SprintConfig];
    try {
      fresh = await Promise.all([
        fetchMembers(boardId),
        fetchBlocks(boardId),
        fetchSprintConfig(boardId),
      ]);
    } catch {
      get().addToast(RECONCILE_FAILED_MESSAGE, 'error');
      return;
    }
    // A board switch while the refetch was in flight makes this answer stale.
    if (get().currentBoardId !== boardId) return;
    const [members, blocks, sprintConfig] = fresh;

    set(state => {
      // Blocks being dragged or resized keep the local version — and stay even
      // if the server no longer has them — so nothing jumps under the pointer.
      // `commitBlock` reconciles them when the gesture ends.
      const locked = state.lockedBlockIds;
      const merged = blocks.map(server => {
        if (!locked.has(server.id)) return server;
        return state.blocks.find(b => b.id === server.id) ?? server;
      });
      const serverIds = new Set(blocks.map(b => b.id));
      const heldBack = state.blocks.filter(b => locked.has(b.id) && !serverIds.has(b.id));
      const nextBlocks = [...merged, ...heldBack];
      return {
        members,
        blocks: nextBlocks,
        selectedBlockId: nextBlocks.some(b => b.id === state.selectedBlockId)
          ? state.selectedBlockId
          : null,
        sprintAnchorDate: sprintConfig.anchorDate,
        sprintLengthDays: sprintConfig.lengthDays,
        sprintUpdatedAt: sprintConfig.updatedAt,
      };
    });
  },

  // Toast actions
  addToast: (message, type = 'error', action) => set(state => ({
    toasts: [...state.toasts, { id: crypto.randomUUID(), message, type, action }],
  })),

  dismissToast: (id) => set(state => ({
    toasts: state.toasts.filter(t => t.id !== id),
  })),

  // Lock management
  lockBlock: (id) => set(state => {
    // Remember where the gesture started, for the undo step commitBlock records.
    const block = state.blocks.find(b => b.id === id);
    if (block && !state.lockedBlockIds.has(id)) {
      lockSnapshots.set(id, { startDate: block.startDate, endDate: block.endDate });
    }
    const next = new Set(state.lockedBlockIds);
    next.add(id);
    return { lockedBlockIds: next };
  }),

  unlockBlock: (id) => set(state => {
    const next = new Set(state.lockedBlockIds);
    next.delete(id);
    return { lockedBlockIds: next };
  }),
}));
