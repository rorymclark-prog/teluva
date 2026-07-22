import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Register the push service worker (prod-only, fully defensive — never throws,
// never blocks app start). Enables Web Push for the installed PWA; a no-op in
// dev or where serviceWorker is unsupported. See src/utils/pushClient.ts.
import('./utils/pushClient').then(({ registerServiceWorker }) => {
  registerServiceWorker();
}).catch(() => { /* push is a bonus; ignore any load failure */ });
