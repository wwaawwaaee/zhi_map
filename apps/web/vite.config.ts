import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({ root, build: { outDir: 'dist', emptyOutDir: true }, server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8000', '/healthz': 'http://127.0.0.1:8000', '/readyz': 'http://127.0.0.1:8000' } } });
