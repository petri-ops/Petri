/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // 同 vite.config.ts：共享包（frontend 之外）必须与 frontend 用同一份 React
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    // The full app pulls in @biof3/shared/* (vendor submodule) which
    // currently fails to type-check; tests must not transitively import it.
    setupFiles: [],
  },
});
