import { create } from 'zustand';
import type { Block, Member, ContextMenuState, SprintConfig, Toast } from '../types';
import { isoToday, addDaysToISO } from '../lib/dates';
import { insertMember, updateMemberName, updateMemberSortOrder, deleteMember as deleteMemberDb } from '../lib/supabase/members';
import { insertBlock, updateBlockFields, deleteBlockById } from '../lib/supabase/blocks';
import { updateSprintConfigFields } from '../lib/supabase/sprintConfig';

interface AppStore {
  // Data state (populated from Supabase)
  members: Member[];
  blocks: Block[];
  sprintAnchorDate: string;
  sprintLengthDays: number;

  // UI state
  selectedBlockId: string | null;
  contextMenu: ContextMenuState | null;
  isModalOpen: boolean;
  isSettingsOpen: boolean;
  editingBlockId: string | null;
  draggingBlockId: string | null;
  newBlockId: string | null;
  renderStartDate: string;
  renderEndDate: string;
  isOnline: boolean;
  toasts: Toast[];
  lockedBlockIds: Set<string>;
  userId: string | null;

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
  updateBlock: (id: string, patch: Partial<Omit<Block, 'id'>>) => void;
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
  closeModal: () => void;
  setSettingsOpen: (open: boolean) => void;
  expandTimelineBefore: (days: number) => void;
  expandTimelineAfter: (days: number) => void;

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

export const useAppStore = create<AppStore>()((set, get) => ({
  // Data state — empty until DataLoader populates
  members: [],
  blocks: [],
  sprintAnchorDate: '2026-02-12',
  sprintLengthDays: 14,

  // UI state
  selectedBlockId: null,
  contextMenu: null,
  isModalOpen: false,
  isSettingsOpen: false,
  editingBlockId: null,
  draggingBlockId: null,
  newBlockId: null,
  renderStartDate: addDaysToISO(today, -14),
  renderEndDate: addDaysToISO(today, 90),
  isOnline: true,
  toasts: [],
  lockedBlockIds: new Set<string>(),
  userId: null,

  // Bulk setters
  setMembers: (members) => set({ members }),
  setBlocks: (blocks) => set({ blocks }),
  setSprintConfig: (config) => set({
    sprintAnchorDate: config.anchorDate,
    sprintLengthDays: config.lengthDays,
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
    };
    set({ members: [...state.members, newMember] });

    const userId = state.userId;
    if (userId) {
      insertMember(newMember, userId).catch(() => {
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
    set(state => ({
      members: state.members.map(m =>
        m.id === id ? { ...m, name } : m
      ),
    }));

    updateMemberName(id, name).catch(() => {
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
    set(state => ({
      members: state.members.map(m =>
        m.id === id ? { ...m, sortOrder: newSortOrder } : m
      ),
    }));

    updateMemberSortOrder(id, newSortOrder).catch(() => {
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
      insertBlock(block, userId).catch(() => {
        set(state => ({
          blocks: state.blocks.filter(b => b.id !== block.id),
        }));
        get().addToast('Failed to add block', 'error');
      });
    }
  },

  updateBlock: (id, patch) => {
    const prevBlocks = get().blocks;
    set(state => ({
      blocks: state.blocks.map(b =>
        b.id === id ? { ...b, ...patch } : b
      ),
    }));

    // Don't fire Supabase during drag/resize — commitBlock handles that
    if (get().lockedBlockIds.has(id)) return;

    if (!get().isOnline) return;

    updateBlockFields(id, patch).catch(() => {
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
    };
    set(state => ({
      blocks: [...state.blocks, newBlock],
      contextMenu: null,
    }));

    const userId = get().userId;
    if (userId) {
      insertBlock(newBlock, userId).catch(() => {
        set(state => ({
          blocks: state.blocks.filter(b => b.id !== newBlock.id),
        }));
        get().addToast('Failed to duplicate block', 'error');
      });
    }
  },

  commitBlock: (id) => {
    if (!get().isOnline) return;
    const block = get().blocks.find(b => b.id === id);
    if (!block) return;
    updateBlockFields(id, {
      startDate: block.startDate,
      endDate: block.endDate,
    }).catch(() => {
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
    set({
      sprintAnchorDate: anchor,
      sprintLengthDays: length,
    });

    updateSprintConfigFields(anchor, length).catch(() => {
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

  closeModal: () => set({
    isModalOpen: false,
    editingBlockId: null,
    newBlockId: null,
  }),

  setSettingsOpen: (open) => set({ isSettingsOpen: open }),

  expandTimelineBefore: (days) => set(state => ({
    renderStartDate: addDaysToISO(state.renderStartDate, -days),
  })),

  expandTimelineAfter: (days) => set(state => ({
    renderEndDate: addDaysToISO(state.renderEndDate, days),
  })),

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
