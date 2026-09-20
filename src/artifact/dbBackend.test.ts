import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Change } from './backend';

/**
 * The artifact's shared document store, faked down to the parts the backend
 * uses. Its `onSnapshot` hands back the error callback so a test can kill a
 * listener the way the real capability does: terminally.
 */
function createFakeDb() {
  const opened: { error?: (e: unknown) => void; unsub: ReturnType<typeof vi.fn> }[] = [];
  const emptySnap = { docs: [], docChanges: () => [] };

  const onSnapshot = (next: (snap: unknown) => void, error?: (e: unknown) => void) => {
    const unsub = vi.fn();
    opened.push({ error, unsub });
    next(emptySnap);
    return unsub;
  };

  const collection = {
    doc: () => docRef,
    where: () => collection,
    orderBy: () => collection,
    get: () => Promise.resolve(emptySnap),
    onSnapshot,
  };

  const docRef = {
    get: () => Promise.resolve({ id: 'x', exists: false, data: () => undefined }),
    set: () => Promise.resolve(),
    update: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    onSnapshot: (next: (snap: unknown) => void, error?: (e: unknown) => void) => {
      const unsub = vi.fn();
      opened.push({ error, unsub });
      next({ id: 'x', exists: false, data: () => undefined });
      return unsub;
    },
  };

  return {
    opened,
    db: { doc: () => docRef, collection: () => collection },
  };
}

/** The backend caches its resolution, so each test needs a fresh module. */
async function freshBackend(db: unknown) {
  vi.resetModules();
  vi.stubGlobal('claude', { use: () => Promise.resolve(db) });
  const module = await import('./backend');
  return module.getBackend();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('artifact db backend subscription', () => {
  it('reports live, and re-opens the snapshots on the backoff after one dies', async () => {
    const fake = createFakeDb();
    const backend = await freshBackend(fake.db);
    const seen: Change[] = [];

    const unsubscribe = backend.subscribe('board-1', c => { seen.push(c); });

    // One listener per collection plus the sprint document.
    expect(fake.opened).toHaveLength(4);
    expect(seen[0]).toEqual({ kind: 'status', status: 'live' });

    // The capability ends a listener it errors on; the others are dropped too
    // so the whole set can be re-opened together.
    seen.length = 0;
    fake.opened[1].error?.(new Error('listener terminated'));
    expect(seen).toContainEqual({ kind: 'status', status: 'reconnecting' });
    expect(fake.opened[0].unsub).toHaveBeenCalled();
    expect(fake.opened).toHaveLength(4);

    seen.length = 0;
    await vi.advanceTimersByTimeAsync(999);
    expect(fake.opened).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.opened).toHaveLength(8);
    expect(seen).toContainEqual({ kind: 'status', status: 'live' });

    unsubscribe();
    expect(fake.opened[7].unsub).toHaveBeenCalled();
  });

  it('backs off further when the retry dies too', async () => {
    const fake = createFakeDb();
    const backend = await freshBackend(fake.db);
    backend.subscribe('board-1', () => {});

    fake.opened[0].error?.(new Error('one'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.opened).toHaveLength(8);

    // The re-opened set delivered snapshots, so the next drop starts over at 1s.
    fake.opened[4].error?.(new Error('two'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.opened).toHaveLength(12);
  });

  it('stops retrying once the subscription is closed', async () => {
    const fake = createFakeDb();
    const backend = await freshBackend(fake.db);
    const unsubscribe = backend.subscribe('board-1', () => {});

    fake.opened[0].error?.(new Error('boom'));
    unsubscribe();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fake.opened).toHaveLength(4);
  });
});
