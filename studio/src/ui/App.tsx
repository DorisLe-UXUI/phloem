import { useStore } from '../store';
import { Editor } from './Editor';
import { Home } from './Home';
import { AdminPage } from './AdminPage';
import { Modals } from './modals';
import { Toasts } from './components';

export function App() {
  const s = useStore();
  return (
    <>
      {s.route.name === 'editor' && s.project ? <Editor /> : s.route.name === 'admin' && s.user?.admin ? <AdminPage /> : <Home />}
      <Modals />
      <Toasts />
    </>
  );
}
