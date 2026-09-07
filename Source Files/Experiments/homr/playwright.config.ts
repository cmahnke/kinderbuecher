import { defineConfig } from '@playwright/test'

export default defineConfig({
  // two projects: the viewer/pipeline tests and the self-contained
  // mnx2musicxml module tests (source, specs and fixtures live in the module
  // folder); one `npm test` runs both against the same dev server
  projects: [
    { name: 'core', testDir: './tests' },
    { name: 'mnx2musicxml', testDir: './mnx2musicxml/tests' },
  ],
  timeout: 30000,
  use: {
    headless: true,
    channel: 'chrome',
    baseURL: 'http://localhost:5199',
  },
  webServer: {
    command: 'npx vite --port 5199',
    port: 5199,
    reuseExistingServer: false,
  },
})
