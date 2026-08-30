import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import StudyApp from './StudyApp';
import './study.css';

const root = document.getElementById('study-root');
if (!root) throw new Error('study root element not found');

createRoot(root).render(
  <StrictMode>
    <StudyApp />
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/study/sw.js', { scope: '/study/' }).catch(() => {
      // The study page remains usable online when registration is unavailable.
    });
  });
}
