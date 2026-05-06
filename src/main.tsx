import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App';

/*
 * --vw-px / --vh-px — JS-measured viewport units in px.
 * Safari computes native `vw` differently than Chrome on macOS in
 * some configurations (particularly with sidebars / multi-monitor),
 * which made fluid clamp(...vw...) sizes drift across browsers and
 * screens. This sets a stable, browser-agnostic value that CSS can
 * use via `calc(var(--vw-px) * 1.6)` in place of `1.6vw`.
 */
function syncViewportUnits(): void {
  const root = document.documentElement;
  root.style.setProperty('--vw-px', `${window.innerWidth / 100}px`);
  root.style.setProperty('--vh-px', `${window.innerHeight / 100}px`);
}
syncViewportUnits();
window.addEventListener('resize', syncViewportUnits, { passive: true });

const root = document.getElementById('root');
if (!root) throw new Error('root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
