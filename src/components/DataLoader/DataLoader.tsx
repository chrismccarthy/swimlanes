import { useEffect, useState, useCallback, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { fetchBoards } from '../../lib/supabase/boards';
import { fetchMembers } from '../../lib/supabase/members';
import { fetchBlocks } from '../../lib/supabase/blocks';
import { fetchSprintConfig } from '../../lib/supabase/sprintConfig';
import { reportError } from '../../lib/errorReporter';
import { FirstBoardScreen } from './FirstBoardScreen';

const centered: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  color: '#64748b',
  fontSize: 14,
};

/**
 * Loads the user's boards, then the contents of whichever board is current.
 *
 * It happens in two stages because everything else hangs off the board: the
 * switcher needs the list before there is anything to show, and switching
 * boards re-runs only the second stage. "Which board's data is in the store"
 * is tracked rather than a loading flag, so a switch is a single state change
 * instead of a loading/ready ping-pong.
 */
export function DataLoader({ children }: { children: React.ReactNode }) {
  const [boardsLoaded, setBoardsLoaded] = useState(false);
  const [boardsFailed, setBoardsFailed] = useState(false);
  const [loadedBoardId, setLoadedBoardId] = useState<string | null>(null);
  /** The board whose data failed to load, if any. */
  const [failedBoardId, setFailedBoardId] = useState<string | null>(null);
  const { user } = useAuth();
  const boards = useAppStore(s => s.boards);
  const currentBoardId = useAppStore(s => s.currentBoardId);
  const setBoards = useAppStore(s => s.setBoards);
  const setCurrentBoard = useAppStore(s => s.setCurrentBoard);
  const setMembers = useAppStore(s => s.setMembers);
  const setBlocks = useAppStore(s => s.setBlocks);
  const setSprintConfig = useAppStore(s => s.setSprintConfig);
  const setUserId = useAppStore(s => s.setUserId);
  const didInit = useRef(false);

  const loadBoards = useCallback(() => {
    fetchBoards()
      .then(loaded => {
        setBoards(loaded);
        // Prefer the board this browser was last on; fall back to the first.
        const remembered = useAppStore.getState().currentBoardId;
        const next = loaded.find(b => b.id === remembered) ?? loaded[0];
        if (next) setCurrentBoard(next.id);
        else useAppStore.setState({ currentBoardId: null });
        setBoardsFailed(false);
        setBoardsLoaded(true);
      })
      .catch(error => {
        reportError(error, { phase: 'load-boards' });
        setBoardsFailed(true);
      });
  }, [setBoards, setCurrentBoard]);

  const loadBoardData = useCallback((boardId: string) => {
    Promise.all([fetchMembers(boardId), fetchBlocks(boardId), fetchSprintConfig(boardId)])
      .then(([members, blocks, sprintConfig]) => {
        // A fast board switch can land an older response last; ignore it.
        if (useAppStore.getState().currentBoardId !== boardId) return;
        setMembers(members);
        setBlocks(blocks);
        setSprintConfig(sprintConfig);
        setFailedBoardId(null);
        setLoadedBoardId(boardId);
      })
      .catch(error => {
        if (useAppStore.getState().currentBoardId !== boardId) return;
        reportError(error, { phase: 'load-board', boardId });
        setFailedBoardId(boardId);
      });
  }, [setMembers, setBlocks, setSprintConfig]);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (user) setUserId(user.id);
    loadBoards();
  }, [user, setUserId, loadBoards]);

  useEffect(() => {
    if (!currentBoardId || currentBoardId === loadedBoardId) return;
    loadBoardData(currentBoardId);
    // `loadedBoardId` is deliberately not a dependency: it is what this effect
    // eventually sets, and re-running on it would refetch the board twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBoardId, loadBoardData]);

  const handleRetry = useCallback(() => {
    if (boardsFailed) {
      setBoardsFailed(false);
      loadBoards();
      return;
    }
    if (currentBoardId) {
      setFailedBoardId(null);
      loadBoardData(currentBoardId);
    }
  }, [boardsFailed, currentBoardId, loadBoards, loadBoardData]);

  // Activate realtime subscriptions and online status tracking
  useRealtimeSync();
  useOnlineStatus();

  if (boardsFailed || (currentBoardId !== null && failedBoardId === currentBoardId)) {
    return (
      <div style={{ ...centered, flexDirection: 'column', gap: 12 }}>
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

  if (!boardsLoaded) {
    return <div style={centered}>Loading data...</div>;
  }

  // Signed in, but on no board yet: nothing to draw a timeline from.
  if (boards.length === 0 || !currentBoardId) {
    return <FirstBoardScreen />;
  }

  if (currentBoardId !== loadedBoardId) {
    return <div style={centered}>Loading data...</div>;
  }

  return <>{children}</>;
}
