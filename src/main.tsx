import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './assets/fonts.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
const mount = root;

/** canvas 畫字不會等 web font：先載好，第一幀就是對的字。 */
async function loadFonts(): Promise<void> {
  try {
    await Promise.all(
      [
        '400 16px Inter',
        '700 16px Inter',
        '400 16px "JetBrains Mono"',
        '700 16px "JetBrains Mono"',
      ].map((f) => document.fonts.load(f)),
    );
  } catch {
    // 載不到就用備援字型照畫
  }
}

loadFonts().then(() => {
  createRoot(mount).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
