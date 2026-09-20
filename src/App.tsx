import { useAuth } from './hooks/useAuth';
import { Login } from './components/Login/Login';
import { DataLoader } from './components/DataLoader/DataLoader';
import { Sidebar } from './components/Sidebar/Sidebar';
import { Timeline } from './components/Timeline/Timeline';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import { resetTimelineCrashHook } from './lib/timelineCrashHook';
import { BlockModal } from './components/Modals/BlockModal';
import { SettingsModal } from './components/Modals/SettingsModal';
import { ShortcutsModal } from './components/Modals/ShortcutsModal';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { BoardSettingsModal } from './components/Modals/BoardSettingsModal';
import { ContextMenu } from './components/ContextMenu/ContextMenu';
import { DialogHost } from './components/Dialog/DialogHost';
import { ToastContainer } from './components/Toast/ToastContainer';
import { OfflineBanner } from './components/OfflineBanner/OfflineBanner';
import { PrintHeader } from './components/Export/PrintHeader';
import { TagFilterBar } from './components/TagFilter/TagFilterBar';
import './App.css';

function App() {
  const { session, loading } = useAuth();
  useKeyboardShortcuts();

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (!session) {
    return <Login />;
  }

  return (
    <DataLoader>
      <PrintHeader />
      {/* The filter strip spans sidebar and timeline alike, so it sits above
          `.app` rather than inside either column. */}
      <div className="app-shell">
        <OfflineBanner />
        <TagFilterBar />
        <div className="app">
          <Sidebar />
          <ErrorBoundary variant="inline" onReset={resetTimelineCrashHook}>
            <Timeline />
          </ErrorBoundary>
        </div>
        <BlockModal />
        <SettingsModal />
        <BoardSettingsModal />
        <ShortcutsModal />
        <ContextMenu />
        <DialogHost />
        <ToastContainer />
      </div>
    </DataLoader>
  );
}

export default App;
