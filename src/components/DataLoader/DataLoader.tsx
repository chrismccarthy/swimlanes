import { useEffect, useState, useCallback, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { fetchMembers } from '../../lib/supabase/members';
import { fetchBlocks } from '../../lib/supabase/blocks';
import { fetchSprintConfig } from '../../lib/supabase/sprintConfig';

export function DataLoader({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const { user } = useAuth();
  const setMembers = useAppStore(s => s.setMembers);
  const setBlocks = useAppStore(s => s.setBlocks);
  const setSprintConfig = useAppStore(s => s.setSprintConfig);
  const setUserId = useAppStore(s => s.setUserId);
  const didInit = useRef(false);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    if (user) {
      setUserId(user.id);
    }

    Promise.all([fetchMembers(), fetchBlocks(), fetchSprintConfig()])
      .then(([members, blocks, sprintConfig]) => {
        setMembers(members);
        setBlocks(blocks);
        setSprintConfig(sprintConfig);
        setStatus('ready');
      })
      .catch(() => {
        setStatus('error');
      });
  }, [user, setUserId, setMembers, setBlocks, setSprintConfig]);

  const handleRetry = useCallback(() => {
    setStatus('loading');
    Promise.all([fetchMembers(), fetchBlocks(), fetchSprintConfig()])
      .then(([members, blocks, sprintConfig]) => {
        setMembers(members);
        setBlocks(blocks);
        setSprintConfig(sprintConfig);
        setStatus('ready');
      })
      .catch(() => {
        setStatus('error');
      });
  }, [setMembers, setBlocks, setSprintConfig]);

  // Activate realtime subscriptions and online status tracking
  useRealtimeSync();
  useOnlineStatus();

  if (status === 'loading') {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#64748b', fontSize: 14 }}>Loading data...</div>;
  }

  if (status === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12 }}>
        <p style={{ color: '#64748b', fontSize: 14 }}>Failed to load data.</p>
        <button
          onClick={handleRetry}
          style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 14 }}
        >
          Retry
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
