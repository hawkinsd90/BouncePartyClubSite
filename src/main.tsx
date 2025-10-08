import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { setupGlobalErrorHandler } from './lib/errorReporter';

setupGlobalErrorHandler();

createRoot(document.getElementById('root')!).render(
  <App />
);
