/**
 * Storage backend for the published-artifact build.
 *
 * The artifact sandbox blocks network access, so the Supabase modules are
 * aliased to this layer at build time (see vite.artifact.config.ts). Data
 * lives in the artifact's shared realtime document store when the page is
 * opened inside claude.ai, and falls back to localStorage anywhere else.
 */
import type { Block, BlockColor, Member, SprintConfig } from '../types';
import { ConflictError } from '../lib/supabase/errors';

export type Change =
  | { kind: 'member'; type: 'upsert'; member: Member }
  | { kind: 'member'; type: 'remove'; id: string }
  | { kind: 'block'; type: 'upsert'; block: Block }
  | { kind: 'block'; type: 'remove'; id: string }
  | { kind: 'sprint'; config: SprintConfig };

export type ChangeListener = (change: Change) => void;

export type MemberPatch = Partial<Omit<Member, 'id' | 'updatedAt'>>;
export type BlockPatch = Partial<Omit<Block, 'id' | 'updatedAt'>>;

export interface Backend {
  fetchMembers(): Promise<Member[]>;
  fetchBlocks(): Promise<Block[]>;
  fetchMember(id: string): Promise<Member | null>;
  fetchBlock(id: string): Promise<Block | null>;
  fetchSprintConfig(): Promise<SprintConfig>;
  /** All writers return the new `updatedAt` they stamped on the document. */
  insertMember(member: Omit<Member, 'updatedAt'>): Promise<string>;
  updateMember(id: string, patch: MemberPatch, expectedUpdatedAt: string): Promise<string>;
  deleteMember(id: string): Promise<void>;
  insertBlock(block: Block): Promise<string>;
  updateBlock(id: string, patch: BlockPatch, expectedUpdatedAt: string): Promise<string>;
  deleteBlock(id: string): Promise<void>;
  setSprintConfig(config: Omit<SprintConfig, 'updatedAt'>, expectedUpdatedAt: string): Promise<string>;
  subscribe(listener: ChangeListener): () => void;
}

/** Version token a never-written sprint config starts from. */
const SPRINT_EPOCH = new Date(0).toISOString();

export const DEFAULT_SPRINT_CONFIG: SprintConfig = {
  anchorDate: '2026-02-12',
  lengthDays: 14,
  updatedAt: SPRINT_EPOCH,
};

function now(): string {
  return new Date().toISOString();
}

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
  return {
    id,
    name: str(d.name),
    sortOrder: num(d.sortOrder, 0),
    updatedAt: str(d.updatedAt, SPRINT_EPOCH),
  };
}

function blockFromDoc(id: string, d: DocData): Block {
  return {
    id,
    memberId: str(d.memberId),
    title: str(d.title),
    startDate: str(d.startDate),
    endDate: str(d.endDate),
    color: color(d.color),
    updatedAt: str(d.updatedAt, SPRINT_EPOCH),
  };
}

function sprintFromDoc(d: DocData | undefined): SprintConfig {
  if (!d) return DEFAULT_SPRINT_CONFIG;
  return {
    anchorDate: str(d.anchorDate, DEFAULT_SPRINT_CONFIG.anchorDate),
    lengthDays: num(d.lengthDays, DEFAULT_SPRINT_CONFIG.lengthDays),
    updatedAt: str(d.updatedAt, DEFAULT_SPRINT_CONFIG.updatedAt),
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
    async fetchMember(id) {
      const snap = await members.doc(id).get();
      return snap.exists ? memberFromDoc(snap.id, snap.data() ?? {}) : null;
    },
    async fetchBlock(id) {
      const snap = await blocks.doc(id).get();
      return snap.exists ? blockFromDoc(snap.id, snap.data() ?? {}) : null;
    },
    async fetchSprintConfig() {
      const snap = await sprint.get();
      return sprintFromDoc(snap.exists ? snap.data() : undefined);
    },
    async insertMember(m) {
      const updatedAt = now();
      await members.doc(m.id).set({ name: m.name, sortOrder: m.sortOrder, updatedAt });
      return updatedAt;
    },
    async updateMember(id, patch, expectedUpdatedAt) {
      // Read-then-write version check. A concurrent writer could slip between
      // the two calls; that window is acceptable for this backend, and the
      // common case (another tab that already wrote) is caught.
      const snap = await members.doc(id).get();
      if (!snap.exists) throw new ConflictError('member', id);
      const current = memberFromDoc(snap.id, snap.data() ?? {});
      if (current.updatedAt !== expectedUpdatedAt) throw new ConflictError('member', id);
      const updatedAt = now();
      await members.doc(id).update({ ...stripUndefined(patch), updatedAt });
      return updatedAt;
    },
    async deleteMember(id) {
      await members.doc(id).delete();
      const owned = await blocks.where('memberId', '==', id).get();
      await Promise.all(owned.docs.map(d => blocks.doc(d.id).delete()));
    },
    async insertBlock(b) {
      const updatedAt = now();
      await blocks.doc(b.id).set({
        memberId: b.memberId,
        title: b.title,
        startDate: b.startDate,
        endDate: b.endDate,
        color: b.color,
        updatedAt,
      });
      return updatedAt;
    },
    async updateBlock(id, patch, expectedUpdatedAt) {
      const snap = await blocks.doc(id).get();
      if (!snap.exists) throw new ConflictError('block', id);
      const current = blockFromDoc(snap.id, snap.data() ?? {});
      if (current.updatedAt !== expectedUpdatedAt) throw new ConflictError('block', id);
      const updatedAt = now();
      await blocks.doc(id).update({ ...stripUndefined(patch), updatedAt });
      return updatedAt;
    },
    deleteBlock(id) {
      return blocks.doc(id).delete();
    },
    async setSprintConfig(config, expectedUpdatedAt) {
      const snap = await sprint.get();
      const current = sprintFromDoc(snap.exists ? snap.data() : undefined);
      if (current.updatedAt !== expectedUpdatedAt) throw new ConflictError('sprint settings');
      const updatedAt = now();
      await sprint.set({
        anchorDate: config.anchorDate,
        lengthDays: config.lengthDays,
        updatedAt,
      });
      return updatedAt;
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
      // Data written before optimistic concurrency existed has no updatedAt;
      // give it the epoch token so the first write still version-checks.
      const withToken = <T extends { updatedAt: string }>(v: T): T =>
        typeof v.updatedAt === 'string' ? v : { ...v, updatedAt: SPRINT_EPOCH };
      return {
        members: Array.isArray(parsed.members) ? parsed.members.map(withToken) : [],
        blocks: Array.isArray(parsed.blocks) ? parsed.blocks.map(withToken) : [],
        sprint: parsed.sprint ? withToken(parsed.sprint) : DEFAULT_SPRINT_CONFIG,
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
    // Another tab in this browser may have written since we last looked, so
    // re-read before mutating; otherwise we would clobber its changes wholesale.
    data = readLocal();
    fn(data);
    writeLocal(data);
    return Promise.resolve();
  };
  const mutateStamped = async (fn: (d: LocalData, updatedAt: string) => void) => {
    const updatedAt = now();
    await mutate(d => fn(d, updatedAt));
    return updatedAt;
  };

  return {
    fetchMembers: () => {
      data = readLocal();
      return Promise.resolve([...data.members].sort((a, b) => a.sortOrder - b.sortOrder));
    },
    fetchBlocks: () => {
      data = readLocal();
      return Promise.resolve([...data.blocks]);
    },
    fetchMember: id => {
      data = readLocal();
      return Promise.resolve(data.members.find(m => m.id === id) ?? null);
    },
    fetchBlock: id => {
      data = readLocal();
      return Promise.resolve(data.blocks.find(b => b.id === id) ?? null);
    },
    fetchSprintConfig: () => {
      data = readLocal();
      return Promise.resolve(data.sprint);
    },
    insertMember: m => mutateStamped((d, updatedAt) => { d.members.push({ ...m, updatedAt }); }),
    updateMember: (id, patch, expectedUpdatedAt) => mutateStamped((d, updatedAt) => {
      const current = d.members.find(m => m.id === id);
      if (!current || current.updatedAt !== expectedUpdatedAt) {
        throw new ConflictError('member', id);
      }
      d.members = d.members.map(m =>
        m.id === id ? { ...m, ...stripUndefined(patch), updatedAt } : m);
    }),
    deleteMember: id => mutate(d => {
      d.members = d.members.filter(m => m.id !== id);
      d.blocks = d.blocks.filter(b => b.memberId !== id);
    }),
    insertBlock: b => mutateStamped((d, updatedAt) => { d.blocks.push({ ...b, updatedAt }); }),
    updateBlock: (id, patch, expectedUpdatedAt) => mutateStamped((d, updatedAt) => {
      const current = d.blocks.find(b => b.id === id);
      if (!current || current.updatedAt !== expectedUpdatedAt) {
        throw new ConflictError('block', id);
      }
      d.blocks = d.blocks.map(b =>
        b.id === id ? { ...b, ...stripUndefined(patch), updatedAt } : b);
    }),
    deleteBlock: id => mutate(d => { d.blocks = d.blocks.filter(b => b.id !== id); }),
    setSprintConfig: (config, expectedUpdatedAt) => mutateStamped((d, updatedAt) => {
      if (d.sprint.updatedAt !== expectedUpdatedAt) throw new ConflictError('sprint settings');
      d.sprint = { ...config, updatedAt };
    }),
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
