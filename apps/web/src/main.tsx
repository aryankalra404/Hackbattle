import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles/theme.css';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
