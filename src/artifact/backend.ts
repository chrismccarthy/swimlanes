/**
 * Storage backend for the published-artifact build.
 *
 * The artifact sandbox blocks network access, so the Supabase modules are
 * aliased to this layer at build time (see vite.artifact.config.ts). Data
 * lives in the artifact's shared realtime document store when the page is
 * opened inside claude.ai, and falls back to localStorage anywhere else.
 */
import type { Block, BlockColor, Member, SprintConfig } from '../types';

export type Change =
  | { kind: 'member'; type: 'upsert'; member: Member }
  | { kind: 'member'; type: 'remove'; id: string }
  | { kind: 'block'; type: 'upsert'; block: Block }
  | { kind: 'block'; type: 'remove'; id: string }
  | { kind: 'sprint'; config: SprintConfig };

export type ChangeListener = (change: Change) => void;

export interface Backend {
  fetchMembers(): Promise<Member[]>;
  fetchBlocks(): Promise<Block[]>;
  fetchSprintConfig(): Promise<SprintConfig>;
  insertMember(member: Member): Promise<void>;
  updateMember(id: string, patch: Partial<Omit<Member, 'id'>>): Promise<void>;
  deleteMember(id: string): Promise<void>;
  insertBlock(block: Block): Promise<void>;
  updateBlock(id: string, patch: Partial<Omit<Block, 'id'>>): Promise<void>;
  deleteBlock(id: string): Promise<void>;
  setSprintConfig(config: SprintConfig): Promise<void>;
  subscribe(listener: ChangeListener): () => void;
}

export const DEFAULT_SPRINT_CONFIG: SprintConfig = {
  anchorDate: '2026-02-12',
  lengthDays: 14,
};

// --- Minimal subset of the artifact `db` capability surface we use ---

type DocData = Record<string, unknown>;

interface DocSnap {
  id: string;
  exists: boolean;
  data(): DocData | undefined;
}

interface DocChange {
  type: 'added' | 'modified' | 'removed';
  doc: DocSnap;
}

interface QuerySnap {
  docs: DocSnap[];
  docChanges(): DocChange[];
}

interface DocRef {
  get(): Promise<DocSnap>;
  set(data: DocData): Promise<void>;
  update(data: DocData): Promise<void>;
  delete(): Promise<void>;
  onSnapshot(next: (snap: DocSnap) => void, error?: (e: unknown) => void): () => void;
}

interface CollectionRef {
  doc(id: string): DocRef;
  where(field: string, op: string, value: unknown): CollectionRef;
  orderBy(field: string, dir?: 'asc' | 'desc'): CollectionRef;
  get(): Promise<QuerySnap>;
  onSnapshot(next: (snap: QuerySnap) => void, error?: (e: unknown) => void): () => void;
}

interface Db {
  doc(path: string): DocRef;
  collection(path: string): CollectionRef;
}

interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}

// --- Validation of untrusted document bodies ---

const COLORS: BlockColor[] = ['blue', 'green', 'amber', 'red', 'purple', 'pink', 'teal', 'orange'];

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function color(v: unknown): BlockColor {
  return COLORS.includes(v as BlockColor) ? (v as BlockColor) : 'blue';
}

function memberFromDoc(id: string, d: DocData): Member {
  return { id, name: str(d.name), sortOrder: num(d.sortOrder, 0) };
}

function blockFromDoc(id: string, d: DocData): Block {
  return {
    id,
    memberId: str(d.memberId),
    title: str(d.title),
    startDate: str(d.startDate),
    endDate: str(d.endDate),
    color: color(d.color),
  };
}

function sprintFromDoc(d: DocData | undefined): SprintConfig {
  if (!d) return DEFAULT_SPRINT_CONFIG;
  return {
    anchorDate: str(d.anchorDate, DEFAULT_SPRINT_CONFIG.anchorDate),
    lengthDays: num(d.lengthDays, DEFAULT_SPRINT_CONFIG.lengthDays),
  };
}

function stripUndefined(patch: Record<string, unknown>): DocData {
  const out: DocData = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// --- Artifact db backend (shared, realtime, persistent) ---

function createDbBackend(db: Db): Backend {
  const members = db.collection('members');
  const blocks = db.collection('blocks');
  const sprint = db.doc('config/sprint');

  return {
    async fetchMembers() {
      const snap = await members.orderBy('sortOrder').get();
      return snap.docs.filter(d => d.exists).map(d => memberFromDoc(d.id, d.data()!));
    },
    async fetchBlocks() {
      const snap = await blocks.get();
      return snap.docs.filter(d => d.exists).map(d => blockFromDoc(d.id, d.data()!));
    },
    async fetchSprintConfig() {
      const snap = await sprint.get();
      return sprintFromDoc(snap.exists ? snap.data() : undefined);
    },
    insertMember(m) {
      return members.doc(m.id).set({ name: m.name, sortOrder: m.sortOrder });
    },
    updateMember(id, patch) {
      return members.doc(id).update(stripUndefined(patch));
    },
    async deleteMember(id) {
      await members.doc(id).delete();
      const owned = await blocks.where('memberId', '==', id).get();
      await Promise.all(owned.docs.map(d => blocks.doc(d.id).delete()));
    },
    insertBlock(b) {
      return blocks.doc(b.id).set({
        memberId: b.memberId,
        title: b.title,
        startDate: b.startDate,
        endDate: b.endDate,
        color: b.color,
      });
    },
    updateBlock(id, patch) {
      return blocks.doc(id).update(stripUndefined(patch));
    },
    deleteBlock(id) {
      return blocks.doc(id).delete();
    },
    setSprintConfig(config) {
      return sprint.set({ anchorDate: config.anchorDate, lengthDays: config.lengthDays });
    },
    subscribe(listener) {
      const onError = (e: unknown) => console.warn('Swimlanes: realtime subscription ended', e);
      const unsubs = [
        members.onSnapshot(snap => {
          for (const c of snap.docChanges()) {
            if (c.type === 'removed') listener({ kind: 'member', type: 'remove', id: c.doc.id });
            else listener({ kind: 'member', type: 'upsert', member: memberFromDoc(c.doc.id, c.doc.data() ?? {}) });
          }
        }, onError),
        blocks.onSnapshot(snap => {
          for (const c of snap.docChanges()) {
            if (c.type === 'removed') listener({ kind: 'block', type: 'remove', id: c.doc.id });
            else listener({ kind: 'block', type: 'upsert', block: blockFromDoc(c.doc.id, c.doc.data() ?? {}) });
          }
        }, onError),
        sprint.onSnapshot(snap => {
          if (snap.exists) listener({ kind: 'sprint', config: sprintFromDoc(snap.data()) });
        }, onError),
      ];
      return () => unsubs.forEach(u => u());
    },
  };
}

// --- localStorage backend (single browser, used outside claude.ai) ---

const LOCAL_KEY = 'swimlanes.artifact.data';

interface LocalData {
  members: Member[];
  blocks: Block[];
  sprint: SprintConfig;
}

function readLocal(): LocalData {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalData>;
      return {
        members: Array.isArray(parsed.members) ? parsed.members : [],
        blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
        sprint: parsed.sprint ?? DEFAULT_SPRINT_CONFIG,
      };
    }
  } catch {
    // fall through to empty state
  }
  return { members: [], blocks: [], sprint: DEFAULT_SPRINT_CONFIG };
}

function writeLocal(data: LocalData) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  } catch {
    // storage may be unavailable; keep working in memory
  }
}

function createLocalBackend(): Backend {
  let data = readLocal();
  const mutate = (fn: (d: LocalData) => void) => {
    fn(data);
    writeLocal(data);
    return Promise.resolve();
  };

  return {
    fetchMembers: () => Promise.resolve([...data.members].sort((a, b) => a.sortOrder - b.sortOrder)),
    fetchBlocks: () => Promise.resolve([...data.blocks]),
    fetchSprintConfig: () => Promise.resolve(data.sprint),
    insertMember: m => mutate(d => { d.members.push(m); }),
    updateMember: (id, patch) => mutate(d => {
      d.members = d.members.map(m => (m.id === id ? { ...m, ...stripUndefined(patch) } : m));
    }),
    deleteMember: id => mutate(d => {
      d.members = d.members.filter(m => m.id !== id);
      d.blocks = d.blocks.filter(b => b.memberId !== id);
    }),
    insertBlock: b => mutate(d => { d.blocks.push(b); }),
    updateBlock: (id, patch) => mutate(d => {
      d.blocks = d.blocks.map(b => (b.id === id ? { ...b, ...stripUndefined(patch) } : b));
    }),
    deleteBlock: id => mutate(d => { d.blocks = d.blocks.filter(b => b.id !== id); }),
    setSprintConfig: config => mutate(d => { d.sprint = config; }),
    subscribe(listener) {
      // Cross-tab sync in the same browser: reload and diff on storage events.
      const onStorage = (e: StorageEvent) => {
        if (e.key !== LOCAL_KEY) return;
        const prev = data;
        data = readLocal();
        const nextMemberIds = new Set(data.members.map(m => m.id));
        const nextBlockIds = new Set(data.blocks.map(b => b.id));
        prev.members.forEach(m => { if (!nextMemberIds.has(m.id)) listener({ kind: 'member', type: 'remove', id: m.id }); });
        prev.blocks.forEach(b => { if (!nextBlockIds.has(b.id)) listener({ kind: 'block', type: 'remove', id: b.id }); });
        data.members.forEach(member => listener({ kind: 'member', type: 'upsert', member }));
        data.blocks.forEach(block => listener({ kind: 'block', type: 'upsert', block }));
        listener({ kind: 'sprint', config: data.sprint });
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    },
  };
}

// --- Resolution ---

let backendPromise: Promise<Backend> | null = null;

async function resolveBackend(): Promise<Backend> {
  const claude = (window as unknown as { claude?: ClaudeRuntime }).claude;
  if (claude && typeof claude.use === 'function') {
    try {
      const db = (await claude.use('db')) as Db | null;
      if (db) return createDbBackend(db);
    } catch (e) {
      console.warn('Swimlanes: shared store unavailable, using this browser only', e);
    }
  }
  return createLocalBackend();
}

export function getBackend(): Promise<Backend> {
  if (!backendPromise) backendPromise = resolveBackend();
  return backendPromise;
}
