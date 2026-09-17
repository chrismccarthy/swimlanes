import { create } from 'zustand';
import type { Block, Member, ContextMenuState, SprintConfig, Toast, ZoomLevel } from '../types';
import { isoToday, addDaysToISO } from '../lib/dates';
import { ZOOM_DAY_WIDTH } from '../lib/layout';
import { fetchMember, insertMember, updateMemberName, updateMemberSortOrder, deleteMember as deleteMemberDb } from '../lib/supabase/members';
import { fetchBlock, insertBlock, updateBlockFields, deleteBlockById } from '../lib/supabase/blocks';
import { fetchSprintConfig, updateSprintConfigFields } from '../lib/supabase/sprintConfig';
import { isConflictError } from '../lib/supabase/errors';

interface AppStore {
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
  editingBlockId: string | null;
  draggingBlockId: string | null;
  newBlockId: string | null;
  draftBlock: Block | null;
  renderStartDate: string;
  renderEndDate: string;
  isOnline: boolean;
  toasts: Toast[];
  lockedBlockIds: Set<string>;
  userId: string | null;
  zoom: ZoomLevel;
  /** Derived from `zoom` — kept in sync by `setZoom` so components can select it directly */
  dayWidth: number;

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
  addBlock: (block: Block) => void;
  updateBlock: (id: string, patch: Partial<Omit<Block, 'id' | 'updatedAt'>>) => void;
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
  openNewBlockModal: (block: Block) => void;
  closeModal: () => void;
  setSettingsOpen: (open: boolean) => void;
  expandTimelineBefore: (days: number) => void;
  expandTimelineAfter: (days: number) => void;
  setZoom: (zoom: ZoomLevel) => void;

  // Online/offline
  setOnline: (online: boolean) => void;

  // Toast actions
  addToast: (message: string, type?: 'error' | 'info') => void;
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
async function resolveSprintConflict() {
  try {
    const fresh = await fetchSprintConfig();
    useAppStore.getState().setSprintConfig(fresh);
  } catch {
    // Keep what we have; the toast warns.
  }
  useAppStore.getState().addToast(CONFLICT_SPRINT_MESSAGE, 'error');
}

const ZOOM_STORAGE_KEY = 'swimlanes.zoom';

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

const initialZoom = loadZoom();

export const useAppStore = create<AppStore>()((set, get) => ({
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
  editingBlockId: null,
  draggingBlockId: null,
  newBlockId: null,
  draftBlock: null,
  renderStartDate: addDaysToISO(today, -14),
  renderEndDate: addDaysToISO(today, 90),
  isOnline: true,
  toasts: [],
  lockedBlockIds: new Set<string>(),
  userId: null,
  zoom: initialZoom,
  dayWidth: ZOOM_DAY_WIDTH[initialZoom],

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
    const state = get();
    const maxSort = state.members.length > 0
      ? Math.max(...state.members.map(m => m.sortOrder))
      : 0;
    const newMember: Member = {
      id: crypto.randomUUID(),
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
    const expectedUpdatedAt = prevMembers.find(m => m.id === id)?.updatedAt;
    if (expectedUpdatedAt === undefined) return;
    set(state => ({
      members: state.members.map(m =>
        m.id === id ? { ...m, name } : m
      ),
    }));

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
    const expectedUpdatedAt = prevMembers.find(m => m.id === id)?.updatedAt;
    if (expectedUpdatedAt === undefined) return;
    set(state => ({
      members: state.members.map(m =>
        m.id === id ? { ...m, sortOrder: newSortOrder } : m
      ),
    }));

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

  addBlock: (block) => {
    if (!get().isOnline) {
      get().addToast('Cannot save while offline', 'error');
      return;
    }
    set(state => ({
      blocks: [...state.blocks, block],
    }));

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
    const expectedUpdatedAt = prevBlocks.find(b => b.id === id)?.updatedAt;
    if (expectedUpdatedAt === undefined) return;
    set(state => ({
      blocks: state.blocks.map(b =>
        b.id === id ? { ...b, ...patch } : b
      ),
    }));

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
    set(state => ({
      blocks: state.blocks.filter(b => b.id !== id),
      selectedBlockId: state.selectedBlockId === id ? null : state.selectedBlockId,
      contextMenu: null,
    }));

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
    const newBlock: Block = {
      ...original,
      id: crypto.randomUUID(),
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
    const prevAnchor = get().sprintAnchorDate;
    const prevLength = get().sprintLengthDays;
    const expectedUpdatedAt = get().sprintUpdatedAt;
    set({
      sprintAnchorDate: anchor,
      sprintLengthDays: length,
    });

    updateSprintConfigFields(anchor, length, expectedUpdatedAt).then(updatedAt => {
      set({ sprintUpdatedAt: updatedAt });
    }).catch(error => {
      if (isConflictError(error)) {
        void resolveSprintConflict();
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

  // Online/offline
  setOnline: (online) => set({ isOnline: online }),

  // Toast actions
  addToast: (message, type = 'error') => set(state => ({
    toasts: [...state.toasts, { id: crypto.randomUUID(), message, type }],
  })),

  dismissToast: (id) => set(state => ({
    toasts: state.toasts.filter(t => t.id !== id),
  })),

  // Lock management
  lockBlock: (id) => set(state => {
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
