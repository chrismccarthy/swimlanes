import { Sidebar } from './components/Sidebar/Sidebar';
import { Timeline } from './components/Timeline/Timeline';
import { BlockModal } from './components/Modals/BlockModal';
import { SettingsModal } from './components/Modals/SettingsModal';
import { ContextMenu } from './components/ContextMenu/ContextMenu';
import './App.css';

function App() {
  return (
    <div className="app">
      <Sidebar />
      <Timeline />
      <BlockModal />
      <SettingsModal />
      <ContextMenu />
    </div>
  );
}

export default App;
