// Artifact-build replacement for hooks/useRealtimeSync.ts.
import { useEffect } from 'react';
import { getBackend } from './backend';
import { useAppStore } from '../store/useAppStore';

export function useRealtimeSync() {
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    getBackend().then(backend => {
      if (cancelled) return;
      unsubscribe = backend.subscribe(change => {
        const store = useAppStore.getState();
        switch (change.kind) {
          case 'member':
            if (change.type === 'remove') store.removeRemoteMember(change.id);
            else store.mergeRemoteMember(change.member);
            break;
          case 'block':
            if (change.type === 'remove') {
              store.removeRemoteBlock(change.id);
            } else if (!store.lockedBlockIds.has(change.block.id)) {
              // Skip while this block is being dragged/resized locally
              store.mergeRemoteBlock(change.block);
            }
            break;
          case 'sprint':
            store.setSprintConfig(change.config);
            break;
        }
      });
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
}
