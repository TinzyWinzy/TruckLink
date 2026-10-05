import { defineConfig, devices } from '@playwright/test'

// UI contract harness: all /api requests are intercepted by synthetic fixtures.
// Server command behavior is tested separately in backend/test_regulatory.py.
export default defineConfig({
  testDir: './e2e/regulatory', workers: 1, retries: 0, timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:5197', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npx vite --port 5197 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5197', reuseExistingServer: false,
    env: { VITE_API_URL: 'http://127.0.0.1:5197', VITE_FACILITY_ID: 'synthetic', VITE_FIREBASE_PROJECT_ID: '' } },
})
