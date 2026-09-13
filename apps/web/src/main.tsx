import { createRoot } from 'react-dom/client';
import { AppShell, ErrorBoundary } from './components/AppShell.js';
import './style.css';

createRoot(document.getElementById('root')!).render(<ErrorBoundary><AppShell /></ErrorBoundary>);
