import { resolve } from 'node:path'

import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const projectRoot = import.meta.dirname

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(projectRoot, 'dist-electron/main'),
      rollupOptions: {
        input: {
          index: resolve(projectRoot, 'electron/main.ts'),
          'import-worker': resolve(projectRoot, 'electron/import-worker.ts'),
        },
        external: ['better-sqlite3', 'electron'],
        output: {
          entryFileNames: '[name].js',
          format: 'es',
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(projectRoot, 'dist-electron/preload'),
      rollupOptions: {
        input: resolve(projectRoot, 'electron/preload.ts'),
        external: ['electron'],
        output: {
          entryFileNames: 'index.cjs',
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(projectRoot, 'web'),
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@shared': resolve(projectRoot, 'shared'),
      },
    },
    build: {
      outDir: resolve(projectRoot, 'web-dist'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(projectRoot, 'web/index.html'),
      },
    },
  },
})
