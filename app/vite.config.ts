import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pin the dev server to a fixed port so the magic-link redirect URL registered in
  // Supabase (http://localhost:5174) stays valid. strictPort fails loudly if 5174 is
  // taken rather than silently drifting to another port and breaking the redirect.
  server: { port: 5174, strictPort: true },
})
