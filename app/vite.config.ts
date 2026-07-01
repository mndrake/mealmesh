import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pin the dev server to a fixed port so the magic-link redirect URL registered in
  // Supabase (http://localhost:5174) stays valid. strictPort fails loudly if 5174 is
  // taken rather than silently drifting to another port and breaking the redirect.
  server: { port: 5174, strictPort: true },
  build: {
    // Split the big, rarely-changing pieces into their own cacheable chunks so a code
    // change doesn't force users to re-download the 278-recipe dataset or the vendor libs,
    // and they load in parallel. Tab views are already lazy-loaded (see App.tsx).
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('src/data/recipes.json')) return 'recipe-data'
          if (id.includes('node_modules/@supabase')) return 'supabase'
          if (id.includes('node_modules/react')) return 'react-vendor'
        },
      },
    },
    // The recipe dataset alone is sizeable; with it in its own cached chunk the remaining
    // app code is well under this. Kept as a guardrail, not silenced entirely.
    chunkSizeWarningLimit: 800,
  },
})
