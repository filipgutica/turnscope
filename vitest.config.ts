import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    exclude: ['dist/**', 'dist-electron/**', 'web-dist/**', 'node_modules/**'],
    environmentMatchGlobs: [['web/**/*.test.ts', 'happy-dom']],
    coverage: {
      reporter: ['text', 'json'],
    },
  },
})
