import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const server = process.env.VITE_API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { target: 'es2020' },
  server: {
    host: true,
    port: 5173,
    allowedHosts: true, // lets a Cloudflare quick tunnel reach the dev server from a phone
    proxy: { '/api': server, '/media': server },
  },
});
