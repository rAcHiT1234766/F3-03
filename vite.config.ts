import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/** Identifies the build in Settings and in evidence: FIELDLOG_BUILD_ID, else the Git commit. */
function buildId(): string {
  if (process.env.FIELDLOG_BUILD_ID) return process.env.FIELDLOG_BUILD_ID
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'local'
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(`${version}+${buildId()}`) },
  plugins: [
    vue(),
    VitePWA({
      // One custom worker for precaching, update messages and FCM.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      // Registration happens through `virtual:pwa-register` in src/pwa.ts only.
      injectRegister: false,
      injectManifest: {
        // Every built chunk, including lazy routes, so unvisited screens open offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
      manifest: {
        id: '/',
        name: 'FieldLog — offline job tracker',
        short_name: 'FieldLog',
        description:
          'Field-service job tracker that keeps working offline and syncs when connected.',
        start_url: '/jobs',
        scope: '/',
        display: 'standalone',
        background_color: '#f5f6f4',
        theme_color: '#1f6f5c',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  preview: { port: 4173, strictPort: true },
})
