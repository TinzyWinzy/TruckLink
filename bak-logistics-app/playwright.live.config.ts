import { defineConfig, devices } from '@playwright/test'

// Live yard harness (SAD §13 CI job 3): boots against a Django server seeded
// by the workflow's bootstrap step (tenant CI Fleet / facility ci-yard /
// staff TRK-CI-1 PIN 1234). Separate port from the demo config so both
// suites can run on one machine.
export default defineConfig({
  testDir: './e2e/live',
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5198',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --port 5198 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5198',
    reuseExistingServer: false,
    timeout: 90000,
    env: {
      VITE_API_URL: 'http://127.0.0.1:8000',
      VITE_FACILITY_ID: 'ci-yard',
    },
  },
})
