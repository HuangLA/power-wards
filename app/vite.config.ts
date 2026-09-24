import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: 'localhost',
    strictPort: true,
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
