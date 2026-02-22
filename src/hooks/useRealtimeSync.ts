import { useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { useAppStore } from '../store/useAppStore';
import { memberFromDb, blockFromDb, sprintConfigFromDb } from '../lib/supabase/mappers';
import type { DbMember, DbBlock, DbSprintConfig } from '../lib/supabase/mappers';

export function useRealtimeSync() {
  useEffect(() => {
    const channel = supabase
      .channel('db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'members' },
        (payload) => {
          const store = useAppStore.getState();
          if (payload.eventType === 'INSERT') {
            const member = memberFromDb(payload.new as DbMember);
            if (!store.members.find(m => m.id === member.id)) {
              store.mergeRemoteMember(member);
            }
          } else if (payload.eventType === 'UPDATE') {
            const member = memberFromDb(payload.new as DbMember);
            store.mergeRemoteMember(member);
          } else if (payload.eventType === 'DELETE') {
            store.removeRemoteMember((payload.old as { id: string }).id);
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'blocks' },
        (payload) => {
          const store = useAppStore.getState();
          if (payload.eventType === 'INSERT') {
            const block = blockFromDb(payload.new as DbBlock);
            if (!store.blocks.find(b => b.id === block.id)) {
              store.mergeRemoteBlock(block);
            }
          } else if (payload.eventType === 'UPDATE') {
            const block = blockFromDb(payload.new as DbBlock);
            // Skip update if this block is being actively dragged/resized
            if (store.lockedBlockIds.has(block.id)) return;
            store.mergeRemoteBlock(block);
          } else if (payload.eventType === 'DELETE') {
            store.removeRemoteBlock((payload.old as { id: string }).id);
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sprint_config' },
        (payload) => {
          const config = sprintConfigFromDb(payload.new as DbSprintConfig);
          useAppStore.getState().setSprintConfig(config);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
}
