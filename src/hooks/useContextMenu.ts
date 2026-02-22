import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';

/** Hook to dismiss context menu on outside click or Escape */
export function useContextMenuDismiss() {
  const contextMenu = useAppStore(s => s.contextMenu);
  const setContextMenu = useAppStore(s => s.setContextMenu);

  useEffect(() => {
    if (!contextMenu) return;

    const dismiss = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };

    // Delay slightly so the right-click event doesn't immediately dismiss
    const timer = setTimeout(() => {
      document.addEventListener('click', dismiss);
      document.addEventListener('keydown', handleKey);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', dismiss);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu, setContextMenu]);
}
