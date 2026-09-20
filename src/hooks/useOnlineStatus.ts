import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';

export function useOnlineStatus() {
  const setOnline = useAppStore(s => s.setOnline);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      // Read the board at reconnect time, not at render time, so a switch that
      // happened while offline is honoured. `reconcileBoard` is the same
      // refetch-and-merge the realtime hook runs after a dropped channel.
      const store = useAppStore.getState();
      const boardId = store.currentBoardId;
      if (boardId) void store.reconcileBoard(boardId);
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    setOnline(navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setOnline]);
}
