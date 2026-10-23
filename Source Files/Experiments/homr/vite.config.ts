import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// The locally linked tify-plugins checkout (npm link): the shared
// assets/ts/tify.ts lives at the blog root, whose own node_modules shadows
// this folder's dependency with a stale copy — alias it explicitly.
const linkedMusicxml = resolve(
  '/Users/cmahnke/projects/projektemacher/tify-plugins/packages/plugin-musicxml/dist',
)

export default defineConfig({
  base: '/',
  resolve: {
    alias: [
      {
        find: /^@projektemacher\/tify-plugin-musicxml$/,
        replacement: resolve(linkedMusicxml, 'index.js'),
      },
      {
        find: /^@projektemacher\/tify-plugin-musicxml\/musicxml\.css$/,
        replacement: resolve(linkedMusicxml, 'index.css'),
      },
    ],
  },
  server: {
    port: 5199,
    strictPort: true,
    // the linked tify-plugins checkout lives outside the workspace root —
    // serve its module files during development
    fs: {
      allow: ['.', '/Users/cmahnke/projects/projektemacher/tify-plugins'],
    },
  },
  preview: {
    port: 5199,
    strictPort: true,
  },
  optimizeDeps: {
    include: ['@xmldom/xmldom', 'fraction.js', 'xpath', 'tify'],
  },
})
