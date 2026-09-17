import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Unit-test config, kept separate from `vite.config.ts` so the app build never
 * carries test-only settings. The Playwright suite in `e2e/` is excluded — it
 * is run by `npm run test:e2e`, not by Vitest.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Globals stay off: every test imports `describe`/`it`/`expect`/`vi`
    // explicitly, so `tsconfig.app.json` needs no extra `types` entry.
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // `src/lib/supabase/client.ts` throws at import time without these, which
    // would break any test that imports the store without mocking the data
    // layer. Nothing ever connects: the credentials are placeholders and the
    // data modules are mocked wherever a test exercises them.
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    restoreMocks: true,
  },
});
