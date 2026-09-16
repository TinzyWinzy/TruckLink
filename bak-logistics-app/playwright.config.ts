import { defineConfig, devices } from '@playwright/test'

// Demo-mode harness: blank Firebase keys force isLive()=false so gate sign-in
// renders the role-switcher tabs (.env.local would otherwise boot live staging).
const demoEnv = {
  VITE_FIREBASE_API_KEY: 'x',
  VITE_FIREBASE_AUTH_DOMAIN: 'x',
  VITE_FIREBASE_PROJECT_ID: '',
  VITE_FIREBASE_STORAGE_BUCKET: 'x',
  VITE_FIREBASE_MESSAGING_SENDER_ID: 'x',
  VITE_FIREBASE_APP_ID: '',
  VITE_FACILITY_ID: 'demo-facility',
  VITE_SYNC_API_URL: '',
  VITE_POWERSYNC_URL: '',
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: 2,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5199',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --port 5199 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: false,
    timeout: 90000,
    env: demoEnv,
  },
})
