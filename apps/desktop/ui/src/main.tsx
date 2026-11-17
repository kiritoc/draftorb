import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { reportFirstPaint, sampleProcessUptime } from './metrics';
import './index.css';

const jsBootMs = sampleProcessUptime();
const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
void reportFirstPaint(jsBootMs);
