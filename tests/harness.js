// Shared setup for the automated tests: start the game on its own Vite dev server (a free port, so it never clashes
// with `npm run dev`) and open it in headless Chromium.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export async function startServer() {
  const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false } });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  return { url, close: () => server.close() };
}

export async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (e) {
    if (/Executable doesn't exist/.test(String(e))) {
      console.error('Headless Chromium is missing. Install it once with:  npx playwright install chromium');
      process.exit(1);
    }
    throw e;
  }
}

// Seeded Math.random (the same mulberry32 the game uses for random fields). window.__seed(n) restarts the sequence.
export const SEEDED_RANDOM = `(() => {
  let s = 1;
  Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  window.__seed = n => { s = n; };
})();`;

// Stops the real-time loop so only __splat.step() moves the game (otherwise the menu demo keeps updating G).
export const NO_FRAMES = 'window.requestAnimationFrame = () => 0;';

// With requestAnimationFrame stubbed, waitForFunction must poll on a timer.
export async function waitForHook(page) {
  await page.waitForFunction(() => window.__splat, null, { polling: 100, timeout: 15000 });
}
