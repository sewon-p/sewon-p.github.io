import type { ReactElement } from 'react';
import Home from './pages/Home/Home';

export default function App(): ReactElement {
  return (
    <>
      <a href="#main" className="skipLink">Skip to main content</a>
      <h1 className="srOnly">Sewon Park — engineering and strategy portfolio</h1>
      <main id="main">
        <Home />
      </main>
    </>
  );
}
