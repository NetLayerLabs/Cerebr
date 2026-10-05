import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const sdk = fileURLToPath(new URL('../sdk/src', import.meta.url))
const app = fileURLToPath(new URL('.', import.meta.url))
// launch/config.json (issuance terms) is imported by the landing page.
const launch = fileURLToPath(new URL('../launch', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The SDK is consumed from source (TypeScript, .ts imports): '@cerebr/sdk' is its root,
    // '@cerebr/sdk/<module>' one of its modules (tapeout, neuro).
    alias: [
      { find: /^@cerebr\/sdk$/, replacement: `${sdk}/index.ts` },
      { find: /^@cerebr\/sdk\/([a-z]+)$/, replacement: `${sdk}/$1/index.ts` },
    ],
    // sdk/ has its own node_modules; make both sides share the app's viem.
    dedupe: ['viem'],
  },
  server: { fs: { allow: [app, sdk, launch] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
})
