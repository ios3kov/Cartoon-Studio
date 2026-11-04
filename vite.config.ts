import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4174' } },
  preview: { host: '127.0.0.1', port: 4173 },
  build: {
    target: 'es2022',
    rollupOptions: { input: { studio: fileURLToPath(new URL('./index.html', import.meta.url)), render: fileURLToPath(new URL('./render.html', import.meta.url)) } },
  },
});
