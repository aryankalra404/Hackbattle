import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { XrApp } from './xr/XrApp.js';
import './styles/theme.css';
import './styles/app.css';
import './styles/xr.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

/**
 * Two entry points from one bundle: the editor, and the headset mirror at /xr.
 * A router would be a dependency for a single branch.
 */
const isXr = globalThis.location.pathname.replace(/\/$/, '').endsWith('/xr');

createRoot(root).render(<StrictMode>{isXr ? <XrApp /> : <App />}</StrictMode>);
