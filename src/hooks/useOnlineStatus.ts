import { useEffect, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { fetchMembers } from '../lib/supabase/members';
import { fetchBlocks } from '../lib/supabase/blocks';
import { fetchSprintConfig } from '../lib/supabase/sprintConfig';

export function useOnlineStatus() {
  const setOnline = useAppStore(s => s.setOnline);
  const setMembers = useAppStore(s => s.setMembers);
  const setBlocks = useAppStore(s => s.setBlocks);
  const setSprintConfig = useAppStore(s => s.setSprintConfig);

  const refetchAll = useCallback(() => {
    Promise.all([fetchMembers(), fetchBlocks(), fetchSprintConfig()])
      .then(([members, blocks, sprintConfig]) => {
        setMembers(members);
        setBlocks(blocks);
        setSprintConfig(sprintConfig);
      })
      .catch(() => {
        useAppStore.getState().addToast('Failed to refresh data after reconnect', 'error');
      });
  }, [setMembers, setBlocks, setSprintConfig]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      refetchAll();
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    setOnline(navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setOnline, refetchAll]);
}
