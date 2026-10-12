import './globals.js'; // must be first: exposes React to the other modules
import { createRoot } from 'react-dom/client';
import { ResourceTracker } from './rt/RT.jsx';

// Standalone page for the Resource Tracker. The app renders its own header (navigation, name,
// theme switch and live status); there is no prototype banner in production.
createRoot(document.getElementById('root')).render(<ResourceTracker />);
