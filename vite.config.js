import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  // Empty prefix => load ALL vars. They are only read here (Node side) and never
  // reach browser code, because only VITE_* variables are exposed to the client.
  const env = loadEnv(mode, process.cwd(), '');

  if (!env.FASHN_API_KEY) {
    console.warn('\n[fashn] FASHN_API_KEY is not set. Copy .env.example to .env and add your key.\n');
  }
  if (!env.OPENAI_API_KEY) {
    console.warn('[openai] OPENAI_API_KEY is not set. The "OpenAI image edit" workflow will be unavailable.\n');
  }

  const proxy = {
    '/fashn': {
      target: 'https://api.fashn.ai',
      changeOrigin: true,
      secure: true,
      rewrite: (path) => path.replace(/^\/fashn/, ''),
      headers: { Authorization: `Bearer ${env.FASHN_API_KEY ?? ''}` },
    },
    // Result images live on FASHN's CDN, which does not allow direct browser downloads (CORS).
    // These routes serve them from this app's own address so the app can save them.
    '/cdn': {
      target: 'https://cdn.fashn.ai',
      changeOrigin: true,
      secure: true,
      rewrite: (path) => path.replace(/^\/cdn/, ''),
    },
    '/media': {
      target: 'https://media.fashn.ai',
      changeOrigin: true,
      secure: true,
      rewrite: (path) => path.replace(/^\/media/, ''),
    },
    '/openai': {
      target: 'https://api.openai.com',
      changeOrigin: true,
      secure: true,
      rewrite: (path) => path.replace(/^\/openai/, ''),
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY ?? ''}` },
    },
  };

  return {
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/__tests__/setup.js',
      css: false,
    },
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
  };
});
