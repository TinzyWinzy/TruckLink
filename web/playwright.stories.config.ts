import { defineConfig, devices } from '@playwright/test'

// Only launched by pytest's live_server with a disposable migrated test DB.
if (!process.env.STORY_API_URL || !process.env.STORY_ENTRIES) {
  throw new Error('Run through backend/tests/test_story_browser.py; never target production')
}
const api = new URL(process.env.STORY_API_URL)
if (!['localhost', '127.0.0.1'].includes(api.hostname)) throw new Error('Local test API required')

export default defineConfig({
  testDir: './e2e/stories', workers: 1, retries: 0, timeout: 45000,
  outputDir: './test-results/stories',
  expect: { timeout: 15000 }, reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5196', trace: 'retain-on-failure' },
  webServer: { command: 'npx vite --port 5196 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5196', reuseExistingServer: false,
    env: { VITE_API_URL: process.env.STORY_API_URL, VITE_FACILITY_ID: process.env.STORY_FACILITY!,
      VITE_FIREBASE_PROJECT_ID: '' } },
})
