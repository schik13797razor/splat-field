import { defineConfig } from 'vite';

export default defineConfig({
  // Build with relative paths ("./assets/...") so the game loads from any folder, including GitHub Pages'
  // https://<user>.github.io/splat-field/. Has no effect on `npm run dev`.
  base: './',
});
