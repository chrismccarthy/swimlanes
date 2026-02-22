import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Block, Member, ContextMenuState } from '../types';
import { isoToday, addDaysToISO } from '../lib/dates';

interface AppStore {
  // Persisted state
  members: Member[];
  blocks: Block[];
  sprintAnchorDate: string;
  sprintLengthDays: number;

  // UI state (not persisted)
  selectedBlockId: string | null;
  contextMenu: ContextMenuState | null;
  isModalOpen: boolean;
  isSettingsOpen: boolean;
  editingBlockId: string | null;
  draggingBlockId: string | null;
  newBlockId: string | null;
  renderStartDate: string;
  renderEndDate: string;

  // Member actions
  addMember: (name: string) => void;
  removeMember: (id: string) => void;
  renameMember: (id: string, name: string) => void;
  moveMemberUp: (id: string) => void;
  moveMemberDown: (id: string) => void;

  // Block actions
  addBlock: (block: Omit<Block, 'id'>) => void;
  updateBlock: (id: string, patch: Partial<Omit<Block, 'id'>>) => void;
  deleteBlock: (id: string) => void;
  duplicateBlock: (id: string) => void;

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
}

const today = isoToday();

// Seed data
const SEED_MEMBERS: Member[] = [
  { id: crypto.randomUUID(), name: 'Alice', order: 0 },
  { id: crypto.randomUUID(), name: 'Bob', order: 1 },
  { id: crypto.randomUUID(), name: 'Carol', order: 2 },
];

const SEED_BLOCKS: Block[] = [
  {
    id: crypto.randomUUID(),
    memberId: SEED_MEMBERS[0].id,
    title: 'Design System',
    startDate: addDaysToISO(today, 1),
    endDate: addDaysToISO(today, 8),
    color: 'blue',
  },
  {
    id: crypto.randomUUID(),
    memberId: SEED_MEMBERS[0].id,
    title: 'API Integration',
    startDate: addDaysToISO(today, 5),
    endDate: addDaysToISO(today, 14),
    color: 'purple',
  },
  {
    id: crypto.randomUUID(),
    memberId: SEED_MEMBERS[1].id,
    title: 'Backend Setup',
    startDate: addDaysToISO(today, 2),
    endDate: addDaysToISO(today, 10),
    color: 'green',
  },
  {
    id: crypto.randomUUID(),
    memberId: SEED_MEMBERS[2].id,
    title: 'Testing Framework',
    startDate: addDaysToISO(today, 7),
    endDate: addDaysToISO(today, 18),
    color: 'amber',
  },
];

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      // Persisted state
      members: SEED_MEMBERS,
      blocks: SEED_BLOCKS,
      sprintAnchorDate: '2026-03-05',
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

      // Member actions
      addMember: (name: string) => set(state => {
        const maxOrder = state.members.length > 0
          ? Math.max(...state.members.map(m => m.order))
          : -1;
        return {
          members: [
            ...state.members,
            { id: crypto.randomUUID(), name, order: maxOrder + 1 },
          ],
        };
      }),

      removeMember: (id: string) => set(state => ({
        members: state.members
          .filter(m => m.id !== id)
          .map((m, i) => ({ ...m, order: i })),
        blocks: state.blocks.filter(b => b.memberId !== id),
      })),

      renameMember: (id: string, name: string) => set(state => ({
        members: state.members.map(m =>
          m.id === id ? { ...m, name } : m
        ),
      })),

      moveMemberUp: (id: string) => set(state => {
        const sorted = [...state.members].sort((a, b) => a.order - b.order);
        const idx = sorted.findIndex(m => m.id === id);
        if (idx <= 0) return state;
        const prev = sorted[idx - 1];
        const curr = sorted[idx];
        return {
          members: state.members.map(m => {
            if (m.id === curr.id) return { ...m, order: prev.order };
            if (m.id === prev.id) return { ...m, order: curr.order };
            return m;
          }),
        };
      }),

      moveMemberDown: (id: string) => set(state => {
        const sorted = [...state.members].sort((a, b) => a.order - b.order);
        const idx = sorted.findIndex(m => m.id === id);
        if (idx < 0 || idx >= sorted.length - 1) return state;
        const next = sorted[idx + 1];
        const curr = sorted[idx];
        return {
          members: state.members.map(m => {
            if (m.id === curr.id) return { ...m, order: next.order };
            if (m.id === next.id) return { ...m, order: curr.order };
            return m;
          }),
        };
      }),

      // Block actions
      addBlock: (block: Omit<Block, 'id'>) => set(state => ({
        blocks: [...state.blocks, { ...block, id: crypto.randomUUID() }],
      })),

      updateBlock: (id: string, patch: Partial<Omit<Block, 'id'>>) => set(state => ({
        blocks: state.blocks.map(b =>
          b.id === id ? { ...b, ...patch } : b
        ),
      })),

      deleteBlock: (id: string) => set(state => ({
        blocks: state.blocks.filter(b => b.id !== id),
        selectedBlockId: state.selectedBlockId === id ? null : state.selectedBlockId,
        contextMenu: null,
      })),

      duplicateBlock: (id: string) => set(state => {
        const original = state.blocks.find(b => b.id === id);
        if (!original) return state;
        return {
          blocks: [
            ...state.blocks,
            {
              ...original,
              id: crypto.randomUUID(),
              title: `${original.title} (copy)`,
              startDate: addDaysToISO(original.startDate, 1),
              endDate: addDaysToISO(original.endDate, 1),
            },
          ],
          contextMenu: null,
        };
      }),

      // Sprint settings
      updateSprintSettings: (anchor: string, length: number) => set({
        sprintAnchorDate: anchor,
        sprintLengthDays: length,
      }),

      // UI actions
      setSelectedBlock: (id: string | null) => set({ selectedBlockId: id }),

      setContextMenu: (menu: ContextMenuState | null) => set({ contextMenu: menu }),

      setDraggingBlock: (id: string | null) => set({ draggingBlockId: id }),

      openEditModal: (blockId: string) => set({
        editingBlockId: blockId,
        isModalOpen: true,
        contextMenu: null,
      }),

      closeModal: () => set({
        isModalOpen: false,
        editingBlockId: null,
        newBlockId: null,
      }),

      setSettingsOpen: (open: boolean) => set({ isSettingsOpen: open }),

      expandTimelineBefore: (days: number) => set(state => ({
        renderStartDate: addDaysToISO(state.renderStartDate, -days),
      })),

      expandTimelineAfter: (days: number) => set(state => ({
        renderEndDate: addDaysToISO(state.renderEndDate, days),
      })),
    }),
    {
      name: 'swimlanes-v1',
      partialize: (state) => ({
        members: state.members,
        blocks: state.blocks,
        sprintAnchorDate: state.sprintAnchorDate,
        sprintLengthDays: state.sprintLengthDays,
      }),
    }
  )
);
