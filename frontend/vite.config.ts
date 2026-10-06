import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

// One .env for the whole project lives in the repo root (shared with Docker and the backend).
export default defineConfig(({ mode }) => {
  const envDir = path.resolve(here, '..');
  const env = loadEnv(mode, envDir, '');
  const port = Number(env.FRONTEND_PORT || process.env.FRONTEND_PORT || 5173);
  return {
    envDir,
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(here, 'src') } },
    server: { host: true, port, strictPort: true },
    preview: { host: true, port },
  };
});
