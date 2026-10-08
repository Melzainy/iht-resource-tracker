import './globals.js'; // must be first: exposes React to the other modules
import { createRoot } from 'react-dom/client';
import { ResourceTracker } from './rt/RT.jsx';
import { RT_CONFIG } from './rt/config.js';

// Standalone page for the Resource Tracker (no PM Workflow in this build).
function Shell() {
  const live = RT_CONFIG.backend === 'supabase';
  return <>
    <header className="top"><div className="brand"><span className="mark" aria-hidden="true" />Immersive Homes · Resource Tracker</div></header>
    <div className="proto-banner" role="note"><b>Standalone / Temporary.</b> {live
      ? 'Shared live database: everyone with this link sees and edits the same records. There is no login yet, so do not enter confidential client, salary or HR information.'
      : 'Local preview: changes are saved only in this browser.'}</div>
    <main className="wrap rt-wide"><ResourceTracker /></main>
  </>;
}
createRoot(document.getElementById('root')).render(<Shell />);
