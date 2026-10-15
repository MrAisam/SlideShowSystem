import { defineConfig } from 'vite';

const server = process.env.VITE_API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  build: { target: 'es2022' },
  server: {
    host: true,
    port: 5174,
    proxy: { '/api': server, '/media': server },
  },
});
