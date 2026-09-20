/**
 * Storage backend for the published-artifact build.
 *
 * The artifact sandbox blocks network access, so the Supabase modules are
 * aliased to this layer at build time (see vite.artifact.config.ts). Data
 * lives in the artifact's shared realtime document store when the page is
 * opened inside claude.ai, and falls back to localStorage anywhere else.
 */
import type { Block, Board, Member, BlockColor, SprintConfig } from '../types';
import { ConflictError } from '../lib/supabase/errors';
import { ALL_COLORS } from '../lib/colors';
import { backoffDelay } from '../lib/backoff';
import { normaliseTags } from '../lib/tags';

export type Change =
  /** Connection health, mirroring what the Supabase channel reports. */
  | { kind: 'status'; status: 'live' | 'reconnecting' }
  | { kind: 'boards'; boards: Board[] }
  | { kind: 'member'; type: 'upsert'; member: Member }
  | { kind: 'member'; type: 'remove'; id: string }
  | { kind: 'block'; type: 'upsert'; block: Block }
  | { kind: 'block'; type: 'remove'; id: string }
  | { kind: 'sprint'; config: SprintConfig };

export type ChangeListener = (change: Change) => void;

export type MemberPatch = Partial<Omit<Member, 'id' | 'boardId' | 'updatedAt'>>;
export type BlockPatch = Partial<Omit<Block, 'id' | 'boardId' | 'updatedAt'>>;

/** Sprint fields a client may write; the board and the token are not among them. */
export type SprintFields = Pick<SprintConfig, 'anchorDate' | 'lengthDays'>;

export interface Backend {
  /** Boards in this artifact. Creates the default one on an empty store. */
  fetchBoards(): Promise<Board[]>;
  createBoard(name: string, id?: string): Promise<Board>;
  renameBoard(id: string, name: string, expectedUpdatedAt: string): Promise<string>;
  deleteBoard(id: string): Promise<void>;
  /** Everything below is scoped to one board. */
  fetchMembers(boardId: string): Promise<Member[]>;
  fetchBlocks(boardId: string): Promise<Block[]>;
  fetchMember(id: string): Promise<Member | null>;
  fetchBlock(id: string): Promise<Block | null>;
  fetchSprintConfig(boardId: string): Promise<SprintConfig>;
  /** All writers return the new `updatedAt` they stamped on the document. */
  insertMember(member: Omit<Member, 'updatedAt'>): Promise<string>;
  updateMember(id: string, patch: MemberPatch, expectedUpdatedAt: string): Promise<string>;
  deleteMember(id: string): Promise<void>;
  insertBlock(block: Block): Promise<string>;
  updateBlock(id: string, patch: BlockPatch, expectedUpdatedAt: string): Promise<string>;
  deleteBlock(id: string): Promise<void>;
  setSprintConfig(boardId: string, config: SprintFields, expectedUpdatedAt: string): Promise<string>;
  /**
   * Live changes for one board plus the board list itself. Callers tear the
   * subscription down and re-open it when the current board changes.
   */
  subscribe(boardId: string, listener: ChangeListener): () => void;
}

/** Version token a never-written document starts from. */
const SPRINT_EPOCH = new Date(0).toISOString();

/** The board a store with no boards in it gets. */
export const DEFAULT_BOARD_NAME = 'Team';

export const DEFAULT_SPRINT_FIELDS: SprintFields = {
  anchorDate: '2026-02-12',
  lengthDays: 14,
};

export function defaultSprintConfig(boardId: string): SprintConfig {
  return { boardId, ...DEFAULT_SPRINT_FIELDS, updatedAt: SPRINT_EPOCH };
}

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

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function color(v: unknown): BlockColor {
  return ALL_COLORS.includes(v as BlockColor) ? (v as BlockColor) : 'blue';
}

function boardFromDoc(id: string, d: DocData): Board {
  return {
    id,
    name: str(d.name, DEFAULT_BOARD_NAME),
    // Membership is not enforced in this build — artifact sharing is.
    role: 'owner',
    updatedAt: str(d.updatedAt, SPRINT_EPOCH),
  };
}

function memberFromDoc(id: string, d: DocData): Member {
  return {
    id,
    boardId: str(d.boardId),
    name: str(d.name),
    sortOrder: num(d.sortOrder, 0),
    updatedAt: str(d.updatedAt, SPRINT_EPOCH),
  };
}

function blockFromDoc(id: string, d: DocData): Block {
  return {
    id,
    boardId: str(d.boardId),
    memberId: str(d.memberId),
    title: str(d.title),
    startDate: str(d.startDate),
    endDate: str(d.endDate),
    color: color(d.color),
    // Untrusted document body: anything that is not a list of usable tags
    // collapses to none (see normaliseTags — trimmed, deduped, max 10).
    tags: normaliseTags(d.tags),
    updatedAt: str(d.updatedAt, SPRINT_EPOCH),
  };
}

function sprintFromDoc(boardId: string, d: DocData | undefined): SprintConfig {
  const fallback = defaultSprintConfig(boardId);
  if (!d) return fallback;
  return {
    boardId,
    anchorDate: str(d.anchorDate, fallback.anchorDate),
    lengthDays: num(d.lengthDays, fallback.lengthDays),
    updatedAt: str(d.updatedAt, fallback.updatedAt),
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
  const boards = db.collection('boards');
  const members = db.collection('members');
  const blocks = db.collection('blocks');
  // One sprint document per board, so switching boards switches settings.
  const sprintDoc = (boardId: string) => db.doc(`config/sprint-${boardId}`);

  return {
    async fetchBoards() {
      const snap = await boards.get();
      const found = snap.docs.filter(d => d.exists).map(d => boardFromDoc(d.id, d.data()!));
      if (found.length > 0) return found;
      // A brand-new artifact starts with one board so the app is usable
      // immediately; membership is not a concept here.
      return [await this.createBoard(DEFAULT_BOARD_NAME)];
    },
    async createBoard(name, id) {
      const boardId = id ?? crypto.randomUUID();
      const updatedAt = now();
      await boards.doc(boardId).set({ name, updatedAt });
      return { id: boardId, name, role: 'owner', updatedAt };
    },
    async renameBoard(id, name, expectedUpdatedAt) {
      const snap = await boards.doc(id).get();
      if (!snap.exists) throw new ConflictError('board', id);
      const current = boardFromDoc(snap.id, snap.data() ?? {});
      if (current.updatedAt !== expectedUpdatedAt) throw new ConflictError('board', id);
      const updatedAt = now();
      await boards.doc(id).update({ name, updatedAt });
      return updatedAt;
    },
    async deleteBoard(id) {
      await boards.doc(id).delete();
      const [ownedMembers, ownedBlocks] = await Promise.all([
        members.where('boardId', '==', id).get(),
        blocks.where('boardId', '==', id).get(),
      ]);
      await Promise.all([
        ...ownedMembers.docs.map(d => members.doc(d.id).delete()),
        ...ownedBlocks.docs.map(d => blocks.doc(d.id).delete()),
        sprintDoc(id).delete(),
      ]);
    },
    async fetchMembers(boardId) {
      const snap = await members.where('boardId', '==', boardId).orderBy('sortOrder').get();
      return snap.docs.filter(d => d.exists).map(d => memberFromDoc(d.id, d.data()!));
    },
    async fetchBlocks(boardId) {
      const snap = await blocks.where('boardId', '==', boardId).get();
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
    async fetchSprintConfig(boardId) {
      const snap = await sprintDoc(boardId).get();
      return sprintFromDoc(boardId, snap.exists ? snap.data() : undefined);
    },
    async insertMember(m) {
      const updatedAt = now();
      await members.doc(m.id).set({
        boardId: m.boardId,
        name: m.name,
        sortOrder: m.sortOrder,
        updatedAt,
      });
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
        boardId: b.boardId,
        memberId: b.memberId,
        title: b.title,
        startDate: b.startDate,
        endDate: b.endDate,
        color: b.color,
        tags: normaliseTags(b.tags),
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
      await blocks.doc(id).update({
        ...stripUndefined(patch),
        ...(patch.tags !== undefined ? { tags: normaliseTags(patch.tags) } : {}),
        updatedAt,
      });
      return updatedAt;
    },
    deleteBlock(id) {
      return blocks.doc(id).delete();
    },
    async setSprintConfig(boardId, config, expectedUpdatedAt) {
      const doc = sprintDoc(boardId);
      const snap = await doc.get();
      const current = sprintFromDoc(boardId, snap.exists ? snap.data() : undefined);
      if (current.updatedAt !== expectedUpdatedAt) throw new ConflictError('sprint settings');
      const updatedAt = now();
      await doc.set({
        anchorDate: config.anchorDate,
        lengthDays: config.lengthDays,
        updatedAt,
      });
      return updatedAt;
    },
    subscribe(boardId, listener) {
      // The db capability terminates a listener when it errors and never
      // revives it, so recovery means opening a fresh set of snapshots. All
      // four are re-opened together, on the same backoff the Supabase channel
      // uses, and the first snapshot each one delivers carries the whole
      // current state — which is the gap recovery.
      let closed = false;
      let attempt = 0;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      let unsubs: (() => void)[] = [];

      const teardown = () => {
        unsubs.forEach(u => {
          try {
            u();
          } catch {
            // A listener the capability already dropped may throw; ignore.
          }
        });
        unsubs = [];
      };

      const onError = (e: unknown) => {
        if (closed || retryTimer !== null) return;
        console.warn('Swimlanes: realtime subscription ended, reconnecting', e);
        listener({ kind: 'status', status: 'reconnecting' });
        teardown();
        const delay = backoffDelay(attempt);
        attempt += 1;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (closed) return;
          open();
        }, delay);
      };

      // Any snapshot arriving is proof the connection works: the status goes
      // back to live and the backoff starts over from 1s.
      const ok = () => {
        if (closed) return;
        attempt = 0;
        listener({ kind: 'status', status: 'live' });
      };

      const open = () => {
        unsubs = [
          boards.onSnapshot(snap => {
            ok();
            listener({
              kind: 'boards',
              boards: snap.docs.filter(d => d.exists).map(d => boardFromDoc(d.id, d.data()!)),
            });
          }, onError),
          members.where('boardId', '==', boardId).onSnapshot(snap => {
            ok();
            for (const c of snap.docChanges()) {
              if (c.type === 'removed') listener({ kind: 'member', type: 'remove', id: c.doc.id });
              else listener({ kind: 'member', type: 'upsert', member: memberFromDoc(c.doc.id, c.doc.data() ?? {}) });
            }
          }, onError),
          blocks.where('boardId', '==', boardId).onSnapshot(snap => {
            ok();
            for (const c of snap.docChanges()) {
              if (c.type === 'removed') listener({ kind: 'block', type: 'remove', id: c.doc.id });
              else listener({ kind: 'block', type: 'upsert', block: blockFromDoc(c.doc.id, c.doc.data() ?? {}) });
            }
          }, onError),
          sprintDoc(boardId).onSnapshot(snap => {
            ok();
            if (snap.exists) listener({ kind: 'sprint', config: sprintFromDoc(boardId, snap.data()) });
          }, onError),
        ];
      };

      open();

      return () => {
        closed = true;
        if (retryTimer !== null) clearTimeout(retryTimer);
        retryTimer = null;
        teardown();
      };
    },
  };
}

// --- localStorage backend (single browser, used outside claude.ai) ---

const LOCAL_KEY = 'swimlanes.artifact.data';

export interface LocalData {
  boards: Board[];
  members: Member[];
  blocks: Block[];
  /** Sprint settings per board id. */
  sprints: Record<string, SprintConfig>;
}

/** The shape stored before boards existed: one flat team, one sprint config. */
interface LegacyLocalData {
  members?: (Member & { boardId?: string })[];
  blocks?: (Block & { boardId?: string })[];
  sprint?: SprintConfig;
}

export function emptyLocalData(): LocalData {
  return { boards: [], members: [], blocks: [], sprints: {} };
}

/**
 * Parses stored data, migrating anything written before boards existed.
 *
 * Pre-board data is adopted into a single board named "Team" so nothing is
 * lost: every member and block is stamped with its id and the one sprint
 * config becomes that board's. Exported for the unit test.
 */
export function migrateLocalData(parsed: unknown, boardId: string): LocalData {
  const raw = (parsed ?? {}) as LegacyLocalData & Partial<LocalData>;
  // Data written before optimistic concurrency existed has no updatedAt;
  // give it the epoch token so the first write still version-checks.
  const withToken = <T extends { updatedAt: string }>(v: T): T =>
    typeof v.updatedAt === 'string' ? v : { ...v, updatedAt: SPRINT_EPOCH };

  // Blocks written before tags existed have no `tags` field at all.
  const withTags = (b: Block): Block => ({ ...b, tags: normaliseTags(b.tags) });

  const boards = Array.isArray(raw.boards) ? raw.boards.map(withToken) : [];
  const legacyBoardId = boards.length > 0 ? boards[0].id : boardId;
  const stamp = <T extends { boardId?: string }>(v: T): T =>
    typeof v.boardId === 'string' && v.boardId ? v : { ...v, boardId: legacyBoardId };

  const members = Array.isArray(raw.members) ? raw.members.map(withToken).map(stamp) : [];
  const blocks = Array.isArray(raw.blocks) ? raw.blocks.map(withToken).map(stamp).map(withTags) : [];

  const sprints: Record<string, SprintConfig> = {};
  if (raw.sprints && typeof raw.sprints === 'object') {
    for (const [id, config] of Object.entries(raw.sprints)) {
      sprints[id] = { ...withToken(config), boardId: id };
    }
  }
  // The single pre-boards sprint config becomes the default board's.
  if (raw.sprint && !sprints[legacyBoardId]) {
    sprints[legacyBoardId] = { ...withToken(raw.sprint), boardId: legacyBoardId };
  }

  // Only invent the default board when there is legacy content to hold.
  if (boards.length === 0 && (members.length > 0 || blocks.length > 0 || raw.sprint)) {
    boards.push({
      id: legacyBoardId,
      name: DEFAULT_BOARD_NAME,
      role: 'owner',
      updatedAt: SPRINT_EPOCH,
    });
  }

  return { boards, members, blocks, sprints };
}

function readLocal(): LocalData {
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return emptyLocalData();
    parsed = JSON.parse(raw);
  } catch {
    return emptyLocalData();
  }
  const migrated = migrateLocalData(parsed, crypto.randomUUID());
  // The generated board id must not change between reads, so persist the
  // migrated shape the first time it is produced.
  if (!(parsed as Partial<LocalData>)?.boards && migrated.boards.length > 0) {
    writeLocal(migrated);
  }
  return migrated;
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
    async fetchBoards() {
      data = readLocal();
      if (data.boards.length > 0) return [...data.boards];
      // A fresh browser starts with one board so the app is usable straight
      // away (and so the e2e suite's blank-slate flows still work).
      return [await this.createBoard(DEFAULT_BOARD_NAME)];
    },
    async createBoard(name, id) {
      const boardId = id ?? crypto.randomUUID();
      const board: Board = { id: boardId, name, role: 'owner', updatedAt: now() };
      await mutate(d => { d.boards.push(board); });
      return board;
    },
    renameBoard: (id, name, expectedUpdatedAt) => mutateStamped((d, updatedAt) => {
      const current = d.boards.find(b => b.id === id);
      if (!current || current.updatedAt !== expectedUpdatedAt) {
        throw new ConflictError('board', id);
      }
      d.boards = d.boards.map(b => (b.id === id ? { ...b, name, updatedAt } : b));
    }),
    deleteBoard: id => mutate(d => {
      d.boards = d.boards.filter(b => b.id !== id);
      d.members = d.members.filter(m => m.boardId !== id);
      d.blocks = d.blocks.filter(b => b.boardId !== id);
      delete d.sprints[id];
    }),
    fetchMembers: (boardId) => {
      data = readLocal();
      return Promise.resolve(
        data.members.filter(m => m.boardId === boardId).sort((a, b) => a.sortOrder - b.sortOrder),
      );
    },
    fetchBlocks: (boardId) => {
      data = readLocal();
      return Promise.resolve(data.blocks.filter(b => b.boardId === boardId));
    },
    fetchMember: id => {
      data = readLocal();
      return Promise.resolve(data.members.find(m => m.id === id) ?? null);
    },
    fetchBlock: id => {
      data = readLocal();
      return Promise.resolve(data.blocks.find(b => b.id === id) ?? null);
    },
    fetchSprintConfig: (boardId) => {
      data = readLocal();
      return Promise.resolve(data.sprints[boardId] ?? defaultSprintConfig(boardId));
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
    insertBlock: b => mutateStamped((d, updatedAt) => {
      d.blocks.push({ ...b, tags: normaliseTags(b.tags), updatedAt });
    }),
    updateBlock: (id, patch, expectedUpdatedAt) => mutateStamped((d, updatedAt) => {
      const current = d.blocks.find(b => b.id === id);
      if (!current || current.updatedAt !== expectedUpdatedAt) {
        throw new ConflictError('block', id);
      }
      d.blocks = d.blocks.map(b =>
        b.id === id
          ? { ...b, ...stripUndefined(patch), tags: normaliseTags(patch.tags ?? b.tags), updatedAt }
          : b);
    }),
    deleteBlock: id => mutate(d => { d.blocks = d.blocks.filter(b => b.id !== id); }),
    setSprintConfig: (boardId, config, expectedUpdatedAt) => mutateStamped((d, updatedAt) => {
      const current = d.sprints[boardId] ?? defaultSprintConfig(boardId);
      if (current.updatedAt !== expectedUpdatedAt) throw new ConflictError('sprint settings');
      d.sprints[boardId] = { boardId, ...config, updatedAt };
    }),
    subscribe(boardId, listener) {
      // Nothing to lose a connection to: this browser's own storage is always
      // live. (The offline override still applies — see `setSyncStatus`.)
      listener({ kind: 'status', status: 'live' });
      // Cross-tab sync in the same browser: reload and diff on storage events.
      const onStorage = (e: StorageEvent) => {
        if (e.key !== LOCAL_KEY) return;
        const prev = data;
        data = readLocal();
        listener({ kind: 'boards', boards: [...data.boards] });
        // Only the board on screen is merged into the store; the rest of the
        // artifact's data belongs to other teams.
        const onBoard = <T extends { boardId: string }>(v: T) => v.boardId === boardId;
        const nextMemberIds = new Set(data.members.filter(onBoard).map(m => m.id));
        const nextBlockIds = new Set(data.blocks.filter(onBoard).map(b => b.id));
        prev.members.filter(onBoard).forEach(m => { if (!nextMemberIds.has(m.id)) listener({ kind: 'member', type: 'remove', id: m.id }); });
        prev.blocks.filter(onBoard).forEach(b => { if (!nextBlockIds.has(b.id)) listener({ kind: 'block', type: 'remove', id: b.id }); });
        data.members.filter(onBoard).forEach(member => listener({ kind: 'member', type: 'upsert', member }));
        data.blocks.filter(onBoard).forEach(block => listener({ kind: 'block', type: 'upsert', block }));
        listener({ kind: 'sprint', config: data.sprints[boardId] ?? defaultSprintConfig(boardId) });
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
