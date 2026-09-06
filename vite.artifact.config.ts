import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Build variant for publishing the app as a single-file claude.ai Artifact.
// The artifact sandbox has no network access, so the Supabase modules are
// swapped for src/artifact/*, which uses the artifact's shared document
// store (or localStorage when opened outside claude.ai).
//
//   npm run build:artifact   ->  dist-artifact/swimlanes.html

const art = (file: string) => fileURLToPath(new URL(`./src/artifact/${file}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^.*\/lib\/supabase\/members$/, replacement: art('members.ts') },
      { find: /^.*\/lib\/supabase\/blocks$/, replacement: art('blocks.ts') },
      { find: /^.*\/lib\/supabase\/sprintConfig$/, replacement: art('sprintConfig.ts') },
      { find: /^.*\/lib\/supabase\/client$/, replacement: art('client.ts') },
      { find: /^.*\/hooks\/useRealtimeSync$/, replacement: art('useRealtimeSync.ts') },
      { find: /^.*\/contexts\/AuthContext$/, replacement: art('AuthContext.tsx') },
    ],
  },
  build: {
    outDir: 'dist-artifact',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    cssCodeSplit: false,
  },
});
