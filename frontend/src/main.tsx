import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startInteractionTracking } from './lib/interactionState';
import './index.css';

startInteractionTracking();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
