import { useEffect } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase/client';
import { useAppStore } from '../store/useAppStore';
import { fetchBoards } from '../lib/supabase/boards';
import { memberFromDb, blockFromDb, sprintConfigFromDb } from '../lib/supabase/mappers';
import type { DbMember, DbBlock, DbSprintConfig } from '../lib/supabase/mappers';
import { backoffDelay } from '../lib/backoff';
import { addBreadcrumb } from '../lib/errorReporter';

/**
 * How long the tab must have been hidden before waking it is treated as a gap
 * in the stream. Browsers throttle background sockets, so a long sleep is as
 * good as a disconnection even when the channel never reported one.
 */
export const HIDDEN_GAP_MS = 30_000;

/** Channel states that mean "we are no longer receiving events". */
const DROPPED = ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'];

export function lostAccessMessage(boardName: string): string {
  return `You no longer have access to ${boardName}`;
}

/**
 * Re-reads the board list after a `boards` / `board_members` event.
 *
 * The events themselves are not trusted to describe the change (a row leaving
 * the user's `board_members` arrives as a plain DELETE, and RLS decides what
 * they may still see), so the list is simply read again. If the board on
 * screen is not in the answer, access to it is gone and the user is moved
 * somewhere they can actually be.
 */
async function refreshBoards(): Promise<void> {
  let boards;
  try {
    boards = await fetchBoards();
  } catch {
    // Transient; the next event or reconnect will try again.
    return;
  }
  const store = useAppStore.getState();
  const currentId = store.currentBoardId;
  const previous = store.boards.find(b => b.id === currentId);
  store.setBoards(boards);
  if (!currentId || boards.some(b => b.id === currentId)) return;

  addBreadcrumb('lost access to board');
  store.addToast(lostAccessMessage(previous?.name ?? 'that board'), 'error');
  if (boards.length > 0) {
    store.setCurrentBoard(boards[0].id);
  } else {
    // Nothing left to show — back to the first-run screen.
    useAppStore.setState({ currentBoardId: null, members: [], blocks: [], selectedBlockId: null });
  }
}

/**
 * Live updates for the board currently on screen, plus the user's board list.
 *
 * Every board-scoped subscription is filtered server-side by `board_id`, and
 * the whole channel is torn down and re-created when the user switches boards,
 * so events from another team never reach this client.
 *
 * A websocket that dies is not an error the user can act on, but silently
 * stale data is: the channel's own status drives `syncStatus`, a dropped
 * channel is re-subscribed with exponential backoff until the component
 * unmounts, and coming back re-reads the board, because everything that
 * happened during the gap was never delivered.
 */
export function useRealtimeSync() {
  const boardId = useAppStore(s => s.currentBoardId);
  const userId = useAppStore(s => s.userId);

  useEffect(() => {
    let unmounted = false;
    let channel: RealtimeChannel | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    /** Consecutive failed connections — the backoff's exponent. */
    let attempt = 0;
    /** Set while disconnected: the next successful subscribe must close the gap. */
    let missedEvents = false;
    /** When the tab was hidden, or null while it is visible. */
    let hiddenAt: number | null = null;

    /** Re-read everything that could have changed unseen. */
    const recoverGap = () => {
      const store = useAppStore.getState();
      if (store.currentBoardId) void store.reconcileBoard(store.currentBoardId);
      void refreshBoards();
    };

    const open = () => {
      const ch = supabase.channel(`db-changes:${boardId ?? 'none'}`);

      if (boardId) {
        const scoped = `board_id=eq.${boardId}`;
        ch.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'members', filter: scoped },
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
        );
        ch.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'blocks', filter: scoped },
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
        );
        ch.on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'sprint_config', filter: scoped },
          (payload) => {
            const config = sprintConfigFromDb(payload.new as DbSprintConfig);
            useAppStore.getState().setSprintConfig(config);
          },
        );
      }

      // The board list itself: a board renamed or deleted by its owner, and —
      // via this user's own membership rows — a board shared with them or
      // taken away. `boards` cannot be filtered to "mine" in the subscription,
      // so RLS does that job and every event just re-reads the list.
      ch.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'boards' },
        () => { void refreshBoards(); },
      );
      if (userId) {
        ch.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'board_members', filter: `user_id=eq.${userId}` },
          () => { void refreshBoards(); },
        );
      }

      ch.subscribe((status) => {
        if (unmounted) return;
        const store = useAppStore.getState();
        if (status === 'SUBSCRIBED') {
          attempt = 0;
          store.setSyncStatus('live');
          if (missedEvents) {
            missedEvents = false;
            addBreadcrumb('realtime reconnected');
            recoverGap();
          }
          return;
        }
        if (!DROPPED.includes(status)) return;
        missedEvents = true;
        store.setSyncStatus('reconnecting');
        scheduleRetry();
      });

      channel = ch;
    };

    const scheduleRetry = () => {
      // One timer at a time: several handlers can report the same drop.
      if (unmounted || retryTimer !== null) return;
      const delay = backoffDelay(attempt);
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (unmounted) return;
        // Supabase will not re-subscribe a channel it has torn down, so the
        // only recovery is a brand-new one.
        if (channel) supabase.removeChannel(channel);
        channel = null;
        open();
      }, delay);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      // A backgrounded tab's socket may have been throttled to a standstill
      // without the channel ever saying so.
      if (away > HIDDEN_GAP_MS) recoverGap();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    open();

    return () => {
      unmounted = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      if (channel) supabase.removeChannel(channel);
      channel = null;
    };
  }, [boardId, userId]);
}
