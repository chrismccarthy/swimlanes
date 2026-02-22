import { useAuth } from './hooks/useAuth';
import { Login } from './components/Login/Login';
import { DataLoader } from './components/DataLoader/DataLoader';
import { Sidebar } from './components/Sidebar/Sidebar';
import { Timeline } from './components/Timeline/Timeline';
import { BlockModal } from './components/Modals/BlockModal';
import { SettingsModal } from './components/Modals/SettingsModal';
import { ContextMenu } from './components/ContextMenu/ContextMenu';
import { ToastContainer } from './components/Toast/ToastContainer';
import { OfflineBanner } from './components/OfflineBanner/OfflineBanner';
import './App.css';

function App() {
  const { session, loading } = useAuth();

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (!session) {
    return <Login />;
  }

  return (
    <DataLoader>
      <div className="app">
        <OfflineBanner />
        <Sidebar />
        <Timeline />
        <BlockModal />
        <SettingsModal />
        <ContextMenu />
        <ToastContainer />
      </div>
    </DataLoader>
  );
}

export default App;
