import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App';

/*
 * --vw-px / --vh-px — JS-measured viewport units in px.
 * Safari and Chrome can report native viewport units differently on
 * macOS when toolbars, sidebars, or display scaling are involved.
 * The app uses these measured values for full-height stages and any
 * future viewport-sensitive layout that must stay browser-stable.
 */
function syncViewportUnits(): void {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;
  const desktopScale = Math.max(0.88, Math.min(1.06, width / 1440));
  const uiScale = width <= 720 ? 1 : desktopScale;
  root.style.setProperty('--vw-px', `${width / 100}px`);
  root.style.setProperty('--vh-px', `${height / 100}px`);
  root.style.setProperty('--ui-scale', `${uiScale}`);
}
syncViewportUnits();
window.addEventListener('resize', syncViewportUnits, { passive: true });
window.visualViewport?.addEventListener('resize', syncViewportUnits, { passive: true });

const root = document.getElementById('root');
if (!root) throw new Error('root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
